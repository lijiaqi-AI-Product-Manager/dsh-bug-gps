// Records user actions in a real browser page as replayable steps. An init script listens in
// the capture phase and reports each action with locator candidates (testid > role+name >
// label > #id), computed at event time. Coordinates are never recorded.

import { secretName } from './secrets.js';
import { EnvBlockedError, TestDefinitionError } from './errors.js';
import { CODE_EDITOR_SELECTOR, MAX_EDITOR_CLIPBOARD_BYTES } from './editor-input.js';
import { TOOLBAR_SCRIPT, TOOLBAR_LANGUAGES, recordingToolbarState } from './recording-toolbar.js';
import { CAPTURE_VERSION, CAPTURE_STATE_KINDS } from './recording-contract.js';

const RECORDER_SCRIPT = String.raw`(() => {
  if (window.__buggpsRecorderInstalled) return;
  window.__buggpsRecorderInstalled = true;
  const clipboardLimit = ${MAX_EDITOR_CLIPBOARD_BYTES};
  const codeEditorSelector = ${JSON.stringify(CODE_EDITOR_SELECTOR)};
  const pendingRecords = new Set();
  let recordingConnectionFailed = false;
  window.__buggpsFlushRecording = async () => {
    do {
      const completed = await Promise.all([...pendingRecords]);
      if (recordingConnectionFailed || completed.some((ok) => !ok)) throw new Error('Recording acknowledgement failed');
    } while (pendingRecords.size);
  };
  const send = (ev) => {
    const completed = Promise.resolve().then(() => window.__buggpsRecord(ev)).then((view) => {
        if (!view) return;
        if (!window.__buggpsToolbarState || view.revision >= window.__buggpsToolbarState.revision) window.__buggpsToolbarState = view;
        window.__buggpsUpdateToolbar && window.__buggpsUpdateToolbar(view);
      }).then(() => true).catch(() => { recordingConnectionFailed = true; window.__buggpsToast && window.__buggpsToast('disconnected'); return false; });
    pendingRecords.add(completed);
    void completed.then(() => pendingRecords.delete(completed));
    return completed;
  };
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  // The role tokens supported by the pinned replay engine; abstract and unknown tokens
  // must not become selectors. The first supported token is the ARIA fallback role.
  const roles = new Set('alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid gridcell group heading img insertion link list listbox listitem log main marquee math meter menu menubar menuitem menuitemcheckbox menuitemradio navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem'.split(' '));
  const listen = (type, handler) => document.addEventListener(type, (event) => {
    if (window.__buggpsStopCapture) return;
    try { handler(event); }
    catch { captureIssue('A browser action could not be captured. Start a new recording after resolving the unsupported control.', 'capture-error'); }
  }, true);
  const documentId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const elementIds = new WeakMap();
  let elementCount = 0;
  const identityOf = (el) => {
    if (!elementIds.has(el)) elementIds.set(el, documentId + ':' + (++elementCount));
    return elementIds.get(el);
  };
  // A responsive-layout trigger is an action, not just presentation. Keep it pinned so
  // shortening cannot silently remove the viewport in which the user saw the problem.
  if (window === window.top) {
    let width = innerWidth;
    let height = innerHeight;
    window.addEventListener('resize', () => {
      if (window.__buggpsStopSystemCapture) return;
      if (innerWidth === width && innerHeight === height) return;
      width = innerWidth;
      height = innerHeight;
      send({ type: 'viewport', width, height });
    });
    document.addEventListener('fullscreenchange', () => {
      if (window.__buggpsStopSystemCapture) return;
      if (!document.fullscreenElement) send({ type: 'fullscreen-exit' });
    });
  }

  function roleOf(el) {
    const explicit = (el.getAttribute('role') || '').trim().split(/\s+/).find((role) => roles.has(role));
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'button' || (tag === 'input' && ['button', 'submit', 'reset'].includes(type))) return 'button';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'search') return 'searchbox';
      if (['', 'text', 'email', 'tel', 'url', 'password', 'number'].includes(type)) return type === 'number' ? 'spinbutton' : 'textbox';
    }
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'img' && el.getAttribute('alt')) return 'img';
    if (tag === 'dialog') return 'dialog';
    if (tag === 'aside') return 'complementary';
    if (tag === 'nav') return 'navigation';
    if (tag === 'main') return 'main';
    if (tag === 'article') return 'article';
    if (tag === 'li') return 'listitem';
    if (tag === 'tr') return 'row';
    if ((tag === 'section' || tag === 'form') && (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby'))) return tag === 'form' ? 'form' : 'region';
    return null;
  }

  // Approximates accname "name from content": child aria-label / img alt replace that child's
  // text, hidden subtrees are skipped. Replay falls back to substring matching if it diverges.
  function nameFromContent(el) {
    let out = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { out += n.textContent; continue; }
      if (n.nodeType !== 1 || n.getAttribute('aria-hidden') === 'true' || n.hidden) continue;
      const label = n.getAttribute('aria-label') || (n.tagName === 'IMG' ? n.getAttribute('alt') : null);
      out += ' ' + (label != null ? label : nameFromContent(n)) + ' ';
    }
    return out;
  }

  function labelText(el) {
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) return clean(l.textContent);
    }
    const wrap = el.closest('label');
    if (wrap) {
      const copy = wrap.cloneNode(true);
      copy.querySelectorAll('input,select,textarea').forEach((n) => n.remove());
      return clean(copy.textContent);
    }
    return '';
  }

  function nameOf(el, role) {
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const refs = by.trim().split(/\s+/).map((id) => el.getRootNode().getElementById?.(id)).filter(Boolean);
      if (refs.length) return clean(refs.map((node) => node.getAttribute('aria-label') || (node.tagName === 'IMG' ? node.getAttribute('alt') : null) || node.textContent).join(' '));
    }
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const label = labelText(el);
    if (label) return label;
    if (['button', 'link', 'heading', 'menuitem', 'menuitemcheckbox', 'tab', 'option', 'radio', 'treeitem', 'switch'].includes(role)) {
      return clean(nameFromContent(el) || el.value || el.getAttribute('title'));
    }
    if (role === 'img') return clean(el.getAttribute('alt'));
    // Chromium falls back to the placeholder (then title) for unlabeled text inputs.
    if (['textbox', 'searchbox', 'spinbutton', 'combobox'].includes(role)) return clean(el.getAttribute('placeholder') || el.getAttribute('title'));
    return clean(el.getAttribute('title'));
  }

  // A container must be unique by exact role and name, including an explicitly empty name.
  // Only author-named roles may anchor an unnamed scope; rows can derive names from content.
  const ANCHOR_ROLES = ['dialog', 'region', 'group', 'listitem', 'row', 'form', 'tabpanel', 'article', 'navigation', 'complementary', 'main', 'menu', 'listbox', 'toolbar'];
  const UNNAMED_ANCHORS = new Set(['dialog', 'group', 'tabpanel', 'article', 'navigation', 'complementary', 'main', 'menu', 'listbox', 'toolbar']);
  const ROLE_TAGS = { button: 'button,input[type=button],input[type=submit],input[type=reset]', link: 'a[href]', textbox: 'input,textarea', checkbox: 'input[type=checkbox]' };
  // Layout visibility only: overlay libraries toggle aria-hidden on everything else while a
  // popover opens/closes, which would make every container look hidden at event time.
  const visible = (n) => n.getClientRects().length > 0 && !n.closest('[hidden]');
  // Innermost elements whose normalized text equals value (what getByText(exact) resolves to).
  const textHits = (root, value) => [...root.querySelectorAll('*')].filter((n) =>
    clean(n.textContent) === value && visible(n) && ![...n.children].some((c) => clean(c.textContent) === value));

  function scoped(el, role, text, name = '') {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const ar = roleOf(a);
      if (!ar) continue;
      const an = nameOf(a, ar);
      if (!an && !UNNAMED_ANCHORS.has(ar)) continue;
      if (!ANCHOR_ROLES.includes(ar) && !(ar === 'button' && !role && an === text)) continue;
      const sel = '[role~="' + ar + '"]' + ({ button: ',button,input[type=button],input[type=submit],input[type=reset]', dialog: ',dialog', complementary: ',aside', navigation: ',nav', main: ',main', article: ',article', listitem: ',li', row: ',tr', region: ',section', form: ',form' }[ar] || '');
      const same = [...document.querySelectorAll(sel)].filter((n) => roleOf(n) === ar && nameOf(n, ar) === an && visible(n));
      if (same.length !== 1) continue;
      if (!role) {
        const hits = textHits(a, text);
        const index = hits.findIndex((h) => h === el || el.contains(h));
        if (index >= 0) return { by: 'text', value: text, within: { role: ar, name: an }, index };
        continue;
      }
      const peerSel = '[role~="' + role + '"]' + (ROLE_TAGS[role] ? ',' + ROLE_TAGS[role] : '');
      const peers = [...a.querySelectorAll(peerSel)].filter((n) =>
        roleOf(n) === role && visible(n) && (!name || nameOf(n, role) === name));
      const index = peers.indexOf(el);
      if (index >= 0) return { by: 'role', role, ...(name ? { name } : {}), within: { role: ar, name: an }, index };
    }
    return null;
  }

  function candidates(el) {
    const out = [];
    const tid = el.getAttribute('data-testid');
    if (tid) out.push({ by: 'testId', value: tid });
    const role = roleOf(el);
    const name = role ? nameOf(el, role) : '';
    const caption = editorCaption(el);
    if (caption) { out.push(caption); return out; }
    // Preserve both the repeated action label and its unique image. The browser may
    // include that image name in the accessible name; an unrelated action must not match.
    const img = role ? el.querySelector('img[alt],[role=img][aria-label]') : null;
    const imgName = img && clean(img.getAttribute('alt') || img.getAttribute('aria-label'));
    if (role && name && imgName && imgName !== name) {
      const selector = '[role~="' + role + '"]' + (ROLE_TAGS[role] ? ',' + ROLE_TAGS[role] : '');
      const peers = [...document.querySelectorAll(selector)].filter((node) => roleOf(node) === role && visible(node));
      const repeatedName = peers.filter((node) => nameOf(node, role) === name).length > 1;
      const imagePeers = peers.filter((node) => [...node.querySelectorAll('img[alt],[role=img][aria-label]')].some((child) => clean(child.getAttribute('alt') || child.getAttribute('aria-label')) === imgName));
      if (repeatedName && imagePeers.length === 1 && imagePeers[0] === el) {
        out.push({ by: 'role', role, name, child: { role: 'img', name: imgName }, nameWithChild: true });
        return out;
      }
    }
    if (role && name) {
      const selector = '[role~="' + role + '"]' + (ROLE_TAGS[role] ? ',' + ROLE_TAGS[role] : '');
      const matches = [...document.querySelectorAll(selector)].filter((node) =>
        roleOf(node) === role && nameOf(node, role) === name && visible(node));
      if (matches.length > 1) {
        const s = scoped(el, role, undefined, name);
        if (s) out.push(s);
      }
      out.push({ by: 'role', role, name });
    }
    // Keep a meaningful unique action name even when it also contains an image.
    if (imgName && imgName !== name) out.push({ by: 'role', role, ...(name ? { name } : {}), child: { role: 'img', name: imgName } });
    const label = labelText(el);
    if (label) out.push({ by: 'label', value: label });
    if (el.id && !/^(:|radix-|rc_|semi-)|\d{4,}/.test(el.id)) out.push({ by: 'css', value: '#' + CSS.escape(el.id) });
    // Unnamed control: scoped position, then role alone (replay requires uniqueness).
    if (role && !name) {
      const s = scoped(el, role);
      if (s) out.push(s);
      out.push({ by: 'role', role });
    }
    const text = clean(el.textContent);
    if (!out.length && text && text.length <= 40) {
      // Text alone is often ambiguous (same label in several rows); prefer it scoped.
      const s = scoped(el, null, text);
      if (s) {
        out.push(s);
        // Wait for this named button; matching editor or canvas text is not the
        // recorded control, even when it is the only text currently mounted.
        if (s.within?.role === 'button' && s.within.name === text) return out;
      }
      out.push({ by: 'text', value: text });
    }
    return out;
  }

  // A code editor's generic textarea name may also describe read-only examples.
  // Use an adjacent short caption only when it identifies exactly this one textarea.
  function editorCaption(el) {
    const editor = el.closest('.monaco-editor');
    const label = el.getAttribute('aria-label');
    if (!editor || !label || el.tagName !== 'TEXTAREA') return null;
    for (let container = editor.parentElement, depth = 0; container && container !== document.body && depth < 6; container = container.parentElement, depth++) {
      for (const caption of container.children) {
        if (caption.contains(editor) || caption.children.length || !visible(caption) || ['SCRIPT', 'STYLE'].includes(caption.tagName)) continue;
        const text = clean(caption.textContent);
        if (!text || text.length > 80 || /[\u0000-\u001f\\]/.test(text + label)) continue;
        const matches = new Set([...document.querySelectorAll(container.tagName)].filter((node) => [...node.children].some((child) => child.tagName === caption.tagName && !child.children.length && clean(child.textContent) === text && visible(child)))
          .flatMap((node) => [...node.querySelectorAll('.monaco-editor textarea[aria-label]')].filter((field) => field.getAttribute('aria-label') === label && visible(field))));
        if (matches.size === 1 && matches.has(el)) return { by: 'css', value: container.tagName.toLowerCase() + ':has(> ' + caption.tagName.toLowerCase() + ':text-is(' + JSON.stringify(text) + ')) .monaco-editor textarea[aria-label=' + JSON.stringify(label) + ']' };
      }
    }
    return null;
  }

  // A hover only matters if it alone opened a menu or listbox (tooltips are informational).
  // Any other user action before the popup appears cancels it: then the action opened it.
  const POPUP = '[role=menu],[role=listbox]';
  let lastHover = null;
  let pendingHover = null;
  const cancelHover = () => { if (pendingHover) { pendingHover.disconnect(); pendingHover = null; } };
  window.__buggpsCancelHover = cancelHover;
  listen('mouseover', (e) => {
    if (fromToolbar(e) || window.__buggpsPickKind) return;
    const el = e.target instanceof Element ? e.target : null;
    if (!el || el === lastHover || el.closest(POPUP)) return;
    lastHover = el;
    cancelHover();
    const trigger = el.closest('[aria-haspopup],[aria-expanded],button,[role=button]') || el;
    const obs = new MutationObserver((muts) => {
      const opened = muts.some((m) => [...m.addedNodes].some((n) => n instanceof Element && (n.matches(POPUP) || n.querySelector(POPUP))));
      if (!opened || pendingHover !== obs) return;
      cancelHover();
      try { send({ action: 'hover', target: candidates(trigger) }); }
      catch { captureIssue('A hover action could not be captured. Start a new recording after resolving the unsupported control.', 'capture-error'); }
    });
    pendingHover = obs;
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { if (pendingHover === obs) cancelHover(); }, 600);
  }, true);
  for (const type of ['pointerdown', 'keydown', 'input']) listen(type, cancelHover);

  const CLICKABLE = 'button,a[href],[role=button],[role=link],[role=tab],[role=menuitem],[role=radio],[role=option],summary,input[type=button],input[type=submit]';
  // Fields whose value must never leave the page: the step stores a reference instead.
  const SECRET_HINT = /pass(word|wd|code)?|secret|token|otp|one.?time|cvv|cvc|card.?(num|no)|cc.?num|api.?key|pin.?code|密码|口令|验证码|卡号/i;
  function isSecret(el) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
    if (el.type === 'password') return true;
    if (/password|one-time-code|cc-number|cc-csc|cc-exp/.test(el.autocomplete || '')) return true;
    return SECRET_HINT.test([el.name, el.id, el.getAttribute('aria-label'), el.placeholder, labelText(el)].join(' '));
  }
  const secretLabel = (el) => clean(el.getAttribute('aria-label') || labelText(el) || el.placeholder || el.name || el.id || 'password');
  const controlEnabled = (el) => {
    const control = el.closest('button,input,textarea,select,[role=button],[role=checkbox],[role=radio],[role=combobox],[role=menuitem],[role=option],[role=tab]') || el;
    return !control.matches(':disabled') && !control.closest('[aria-disabled="true"]');
  };
  const fromToolbar = (e) => e.target instanceof Element && e.target.closest('#__buggps_toolbar');
  let replacementTarget = null;
  let pastedTarget = null;
  function captureIssue(message, code = 'editor-input') {
    send({ type: 'capture-issue', code, message });
    window.__buggpsToast && window.__buggpsToast('unsupported-input');
  }
  listen('pointerdown', (e) => {
    if (fromToolbar(e)) return;
    replacementTarget = null;
    pastedTarget = null;
  }, true);
  listen('paste', (e) => {
    if (fromToolbar(e) || !(e.target instanceof Element)) return;
    const el = e.target;
    if (!el.closest('.monaco-editor')) {
      if (el.isContentEditable || el.closest(codeEditorSelector)) captureIssue('This rich editor is not supported for replay; use a supported input control.');
      return; // Ordinary native fields are captured by their resulting input event.
    }
    pastedTarget = el;
    if (replacementTarget !== el) { captureIssue('Code editor input needs Select All followed by Paste; partial paste cannot be replayed reliably.'); return; }
    replacementTarget = null;
    const types = e.clipboardData && [...e.clipboardData.types];
    if (!types || e.clipboardData.files.length || types.some((type) => !type || type.toLowerCase() === 'files' || type.toLowerCase() !== type || type.length > 128) || !types.includes('text/plain') || types.length > 32) { captureIssue('Code editor replay requires string clipboard formats including plain text, without files.'); return; }
    if (isSecret(el) && types.length > 1) { captureIssue('Secret editor input supports plain text only; formatted clipboard data was not stored.'); return; }
    const text = e.clipboardData.getData('text/plain');
    let size = text.length > clipboardLimit ? clipboardLimit + 1 : new TextEncoder().encode(text).length;
    const clipboard = [];
    for (const type of types) {
      if (size > clipboardLimit) break;
      if (type === 'text/plain') { clipboard.push({ type }); continue; }
      const value = e.clipboardData.getData(type);
      size += value.length > clipboardLimit ? clipboardLimit + 1 : new TextEncoder().encode(value).length;
      clipboard.push({ type, value });
    }
    if (size > clipboardLimit) { captureIssue('Code editor clipboard exceeds the 1 MiB capture limit; the payload was not stored.'); return; }
    pastedTarget = el;
    const payload = { action: 'paste', editor: 'monaco', mode: 'replace-all', target: candidates(el), identity: identityOf(el), wasEnabled: controlEnabled(el), ...(types.length > 1 ? { clipboard } : {}) };
    if (isSecret(el)) send({ ...payload, secret: secretLabel(el) });
    else send({ ...payload, value: text });
    setTimeout(() => { if (!e.defaultPrevented) captureIssue('The code editor did not handle the paste event; this recording is not replayable.'); }, 0);
  }, true);
  let lastApplicationFocus = null;
  let spaceClickTarget = null;
  window.__buggpsRestoreApplicationFocus = () => {
    if (!lastApplicationFocus?.isConnected) return false;
    lastApplicationFocus.focus({ preventScroll: true });
    return true;
  };
  window.__buggpsCancelPick = () => {
    window.__buggpsPickKind = null;
    const focused = document.activeElement;
    if (focused?.id === '__buggps_toolbar') focused.shadowRoot?.activeElement?.blur();
    window.__buggpsRestoreApplicationFocus();
    window.__buggpsToast && window.__buggpsToast('selection-cancelled');
  };
  listen('focusin', (e) => {
    if (e.target !== replacementTarget) replacementTarget = null;
    if (!fromToolbar(e) && e.target instanceof HTMLElement) lastApplicationFocus = e.target;
  }, true);

  // Expectation picking: while window.__buggpsPickKind is set, the next click selects an
  // element for the expectation instead of acting on the page (and is not recorded).
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    listen(type, (e) => {
      if (window.__buggpsPickKind && !fromToolbar(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
  }

  listen('click', (e) => {
    if (fromToolbar(e)) return;
    const kind = window.__buggpsPickKind;
    if (kind) {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.__buggpsPickKind = null;
      window.__buggpsSelectionChanged && window.__buggpsSelectionChanged();
      const el = e.target instanceof Element ? (e.target.closest('[data-testid]') || e.target) : null;
      if (!el) return;
      const target = candidates(el);
      if (!target.length) target.push({ by: 'text', value: clean(el.textContent).slice(0, 80) });
      if (isSecret(el)) { window.__buggpsToast && window.__buggpsToast('secret-refused'); return; }
      if (kind === 'checkpoint') {
        // "At this point the page shows X": holds before AND after the fix, so a fix cannot
        // skip the situation the user recorded (and shortening cannot drop the step leading here).
        const field = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
        const now = field ? String(el.value ?? '') : clean(el.textContent);
        const ck = field ? 'value' : (now ? 'text' : 'visible');
        const equals = ck === 'visible' ? undefined : window.prompt(window.__buggpsFormatMessage ? window.__buggpsFormatMessage('checkpointPrompt') : 'BugGPS checkpoint: what should be shown at this point?', now);
        if (equals === null) { window.__buggpsToast && window.__buggpsToast('selection-cancelled'); return; }
        send({ type: 'checkpoint', check: { kind: ck, target, ...(equals !== undefined ? { equals } : {}) } }).then((ok) => { if (ok) window.__buggpsToast && window.__buggpsToast('checkpoint-set'); });
        return;
      }
      const current = kind === 'value' ? (el.value ?? '') : ['visible', 'hidden'].includes(kind) ? visible(el) && getComputedStyle(el).visibility !== 'hidden' : clean(el.textContent);
      let equals;
      if (kind === 'text' || kind === 'value') {
        equals = window.prompt(window.__buggpsFormatMessage ? window.__buggpsFormatMessage('expectedPrompt', { value: current }) : 'BugGPS: current content: "' + current + '"\nWhat should it be?', current);
        if (equals === null) { window.__buggpsToast && window.__buggpsToast('selection-cancelled'); return; }
      }
      send({ type: 'expect', expectation: { kind, target, ...(equals !== undefined ? { equals } : {}) }, current }).then((ok) => { if (ok) window.__buggpsToast && window.__buggpsToast('expectation-set'); });
      return;
    }
    const el = e.target instanceof Element ? clickTarget(e.target) : null;
    if (!el) return;
    // Space produces a native click after keyup. Retain the key, not a second action.
    if (e.detail === 0 && el === spaceClickTarget) { spaceClickTarget = null; return; }
    spaceClickTarget = null;
    send({ action: 'click', target: candidates(el), wasEnabled: controlEnabled(el) });
  }, true);

  // The NEAREST clickable ancestor wins: a standard role, or an onclick property (React sets a
  // no-op one on non-interactive elements that have onClick). A custom select inside a
  // draggable row (role=button) must resolve to the select, not the row. Fallback: outermost
  // element of a contiguous pointer-cursor chain (cursor is inherited by children).
  function clickTarget(node) {
    let pointer = null;
    for (let el = node; el && el !== document.body; el = el.parentElement) {
      if (el.matches(CLICKABLE) || ['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'radio', 'option'].includes(roleOf(el))) return el;
      if (el.matches('[role=dialog],[role=none],[role=presentation]')) break;
      if (el.onclick) return el;
      if (getComputedStyle(el).cursor === 'pointer') pointer = el;
      else if (pointer) break;
    }
    return pointer || node.closest(CLICKABLE);
  }

  listen('input', (e) => {
    if (fromToolbar(e)) return;
    const el = e.target;
    if (el instanceof Element && el.closest(codeEditorSelector)) {
      if (!el.closest('.monaco-editor')) captureIssue('This code editor is not supported for replay; its hidden textarea is not a normal input.');
      else if (pastedTarget !== el) captureIssue('Typing into this code editor cannot be captured faithfully; use Select All followed by Paste.');
      return;
    }
    if (el instanceof Element && el.isContentEditable) { captureIssue('This rich editor is not supported for replay; use a supported input control.'); return; }
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    if (['checkbox', 'radio'].includes(el.type)) return;
    const identity = identityOf(el);
    if (isSecret(el)) { send({ action: 'fill', target: candidates(el), secret: secretLabel(el), identity, wasEnabled: controlEnabled(el) }); return; }
    send({ action: 'fill', target: candidates(el), value: el.value, identity, wasEnabled: controlEnabled(el) });
  }, true);

  listen('change', (e) => {
    if (fromToolbar(e)) return;
    const el = e.target;
    if (el instanceof HTMLSelectElement) send({ action: 'select', target: candidates(el), value: el.value, wasEnabled: controlEnabled(el) });
    else if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) send({ action: 'check', target: candidates(el), value: el.checked, wasEnabled: controlEnabled(el) });
  }, true);

  listen('keydown', (e) => {
    if (e.key === 'Escape' && window.__buggpsPickKind) {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.__buggpsCancelPick();
      return;
    }
    if (fromToolbar(e)) return;
    const el = e.target;
    pastedTarget = null;
    if (el instanceof HTMLTextAreaElement && el.closest('.monaco-editor')) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { replacementTarget = el; return; }
      if (!['Control', 'Meta', 'Shift', 'Alt'].includes(e.key) && !((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v')) replacementTarget = null;
    }
    if (e.key === 'Enter' && (el instanceof HTMLInputElement)) send({ action: 'press', target: candidates(el), value: 'Enter', wasEnabled: controlEnabled(el) });
    else if (e.key === ' ' && !e.repeat && el instanceof Element && !el.closest('input,textarea,[contenteditable=true]')) {
      let control = null;
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        if (node.tagName === 'BUTTON' || ['button', 'combobox'].includes(roleOf(node))) { control = node; break; }
      }
      if (control) {
        spaceClickTarget = control;
        send({ action: 'press', target: candidates(control), value: 'Space', wasEnabled: controlEnabled(control) });
      }
    }
    // Escape closes popovers/dialogs wherever focus is; replay presses it page-wide.
    else if (e.key === 'Escape') send({ action: 'key', target: [{ by: 'page' }], value: 'Escape' });
  }, true);
  listen('keyup', (e) => {
    if (e.key !== ' ') return;
    const control = spaceClickTarget;
    setTimeout(() => { if (spaceClickTarget === control) spaceClickTarget = null; }, 0);
  }, true);
})();`;

/**
 * Starts recording in a new context of `browser`. Returns { page, stop(), steps, finished }.
 * `stop()` resolves to the recorded steps (consecutive keystroke fills merged into one).
 * With `toolbar: true` a floating toolbar lets the user pick the expectation and stop;
 * `finished` resolves when they press stop or close the page.
 */
export async function startRecording(browser, { baseUrl, startPath = '/', toolbar = false, navTimeoutMs = 120_000 }) {
  if (!Number.isInteger(navTimeoutMs) || navTimeoutMs < 1 || navTimeoutMs > 120_000) throw new TestDefinitionError('recording navigation timeout must be between 1 and 120000 ms');
  let startUrl;
  try { startUrl = new URL(startPath, baseUrl); }
  catch { throw new TestDefinitionError('recording needs a valid base URL and start path'); }
  const context = await browser.newContext({ viewport: toolbar ? null : undefined });
  const steps = [{ action: 'goto', url: startPath }];
  const dropped = [];
  // The first check remains primary; additional targets and kinds remain independent.
  // Selecting the same target and kind again edits only that condition.
  const result = { source: 'recorded', captureVersion: CAPTURE_VERSION, capturedChecks: [], expectation: null, also: [], expectedFrom: null, captureIssues: [] };
  let finish;
  const finished = new Promise((r) => { finish = r; });
  let lastFillIdentity = null;
  const secretFields = new Map();
  const secretNames = new Set();
  let recordingActive = true;
  let stopRequested = false;
  let toolbarRevision = 0;
  const preferences = { language: 'zh-CN', collapsed: false, corner: 'br' };
  const view = () => toolbar ? recordingToolbarState(steps, result, preferences, ++toolbarRevision, stopRequested) : null;
  const recordEvent = (ev) => {
    if (!recordingActive || !ev) return;
    if (ev?.type === 'toolbar') {
      if (TOOLBAR_LANGUAGES.includes(ev.language)) preferences.language = ev.language;
      if (typeof ev.collapsed === 'boolean') preferences.collapsed = ev.collapsed;
      if (['br', 'bl', 'tl', 'tr'].includes(ev.corner)) preferences.corner = ev.corner;
      return;
    }
    if (ev?.type) lastFillIdentity = null;
    if (ev?.type === 'expect') { addExpectation(result, ev.expectation, ev.current); return; }
    if (ev?.type === 'checkpoint') { steps[steps.length - 1].check = ev.check; return; }
    if (ev?.type === 'stop') { stopRequested = true; finish('stop'); return; }
    if (ev?.type === 'pin') { if (steps.length > 1) steps[steps.length - 1].pinned = true; return; }
    if (ev?.type === 'viewport') { steps.push({ action: 'viewport', width: ev.width, height: ev.height, pinned: true }); return; }
    if (ev?.type === 'fullscreen-exit') { steps.push({ action: 'exit-fullscreen', pinned: true }); return; }
    if (ev?.type === 'capture-issue') {
      const issue = { code: String(ev.code), message: String(ev.message) };
      if (!result.captureIssues.some((item) => item.code === issue.code && item.message === issue.message)) { result.captureIssues.push(issue); dropped.push(issue); }
      return;
    }
    if (!ev?.target?.length) {
      recordEvent({ type: 'capture-issue', code: 'action-target', message: 'A browser action has no replayable target. Start a new recording with a uniquely labelled control or stable test id.' });
      return;
    }
    const { identity, ...action } = ev;
    ev = action;
    if (ev.secret !== undefined) {
      const field = identity || JSON.stringify(ev.target);
      if (!secretFields.has(field)) {
        const base = secretName(ev.secret);
        let name = base;
        let suffix = 2;
        while (secretNames.has(name)) name = base + '_' + suffix++;
        secretNames.add(name);
        secretFields.set(field, name);
      }
      ev = { action: ev.action, target: ev.target, ...(ev.action === 'paste' ? { editor: ev.editor, mode: ev.mode } : {}), ...(ev.wasEnabled !== undefined ? { wasEnabled: ev.wasEnabled } : {}), value: { secret: secretFields.get(field) } };
    }
    const prev = steps[steps.length - 1];
    if (ev.action === 'fill' && prev?.action === 'fill' && identity && identity === lastFillIdentity && !prev.check && !prev.pinned) {
      prev.value = ev.value; // one human "type into field" action, not one step per keystroke
      return;
    }
    steps.push(ev);
    lastFillIdentity = ev.action === 'fill' ? identity : null;
  };
  const toolbarDocuments = new WeakMap();
  const toolbarNavigations = new WeakMap();
  let recordingPage;
  context.on('page', (page) => {
    recordingPage ??= page;
    page.on('framenavigated', (frame) => {
      toolbarNavigations.set(frame, (toolbarNavigations.get(frame) ?? 0) + 1);
      const entry = toolbarDocuments.get(frame);
      if (entry) entry.current = null;
    });
  });
  const validDocument = (id) => typeof id === 'string' && id.length > 0 && id.length <= 128;
  const registerToolbar = async (frame, id) => {
    if (!frame || !validDocument(id)) return false;
    const navigation = toolbarNavigations.get(frame) ?? 0;
    const current = await frame.evaluate(() => window.__buggpsToolbarDocumentId).catch(() => null);
    if (current !== id || navigation !== (toolbarNavigations.get(frame) ?? 0)) return false;
    let entry = toolbarDocuments.get(frame);
    if (!entry) { entry = { current: null, documents: new Map() }; toolbarDocuments.set(frame, entry); }
    if (entry.documents.has(id)) return entry.current === id;
    entry.current = id;
    entry.documents.set(id, new Map());
    if (entry.documents.size > 64) entry.documents.delete(entry.documents.keys().next().value);
    return true;
  };
  const orderedPreference = (source, ev) => {
    // Existing callers without a toolbar envelope retain their original behavior.
    if (!('documentId' in ev) && !('sequence' in ev)) return ev;
    const entry = toolbarDocuments.get(source.frame);
    if (!validDocument(ev.documentId) || !Number.isSafeInteger(ev.sequence) || ev.sequence < 1 ||
        !entry || entry.current !== ev.documentId) return null;
    const latest = entry.documents.get(ev.documentId);
    const fresh = { type: 'toolbar' };
    for (const key of ['language', 'collapsed', 'corner']) {
      if (!(key in ev) || ev.sequence <= (latest.get(key) ?? 0)) continue;
      latest.set(key, ev.sequence);
      fresh[key] = ev[key];
    }
    return fresh;
  };
  await context.exposeBinding('__buggpsRecord', (source, ev) => {
    // The replay contract currently addresses the original top-level page only. Never
    // flatten a frame/tab action into an identically named control in that page.
    if (source.page !== recordingPage || source.frame !== recordingPage.mainFrame()) {
      if (ev && ev.type !== 'toolbar') recordEvent({ type: 'capture-issue', code: 'unsupported-context', message: 'Actions in embedded frames or additional pages are not supported. Record the scenario in the original top-level page.' });
      return view();
    }
    recordEvent(ev?.type === 'toolbar' ? orderedPreference(source, ev) : ev);
    return view();
  });
  if (toolbar) await context.exposeBinding('__buggpsGetState', async (source, meta) => {
    if (!meta?.documentId) return view();
    const accepted = await registerToolbar(source.frame, meta.documentId);
    return { ...view(), registeredDocumentId: accepted ? meta.documentId : null };
  });
  await context.addInitScript(RECORDER_SCRIPT);
  if (toolbar) await context.addInitScript(TOOLBAR_SCRIPT);
  const page = await context.newPage();
  page.on('close', () => finish('closed'));
  try {
    // Recording must not wait for every image, font or analytics request to finish.
    await page.goto(startUrl.href, { waitUntil: 'domcontentloaded', timeout: navTimeoutMs });
  } catch (error) {
    await context.close().catch(() => {});
    startUrl.username = ''; startUrl.password = ''; startUrl.search = ''; startUrl.hash = '';
    const reason = error.name === 'TimeoutError' ? `recording page did not become ready within ${navTimeoutMs} ms` : `recording navigation failed${String(error.message).match(/net::[A-Z0-9_]+/)?.[0] ? ': ' + String(error.message).match(/net::[A-Z0-9_]+/)[0] : ''}`;
    throw new EnvBlockedError(`${reason} at ${startUrl.href}`, 'Check that the development server is running and inspect its compilation or network errors, then retry recording.');
  }
  result.browser = await page.evaluate(() => ({ viewport: { width: innerWidth, height: innerHeight }, locale: navigator.language, timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone, deviceScaleFactor: devicePixelRatio }));
  let stopPromise;
  return {
    page,
    steps,
    dropped,
    result,
    finished,
    async stop() {
      stopPromise ??= (async () => {
        let timer;
        try {
          const frames = context.pages().flatMap((item) => item.frames());
          if (!frames.length) throw new Error('Recording page closed before acknowledgement');
          await Promise.race([
            Promise.all(frames.map((frame) => frame.evaluate(async () => {
              window.__buggpsStopCapture = true;
              window.__buggpsCancelHover?.();
              if (typeof window.__buggpsFlushRecording !== 'function') throw new Error('Recorder is not available');
              // Browser fullscreen/resize notifications can arrive after the initiating
              // operation resolves. Drain them before freezing system state as well.
              await new Promise((resolve) => setTimeout(resolve, 100));
              window.__buggpsStopSystemCapture = true;
              return window.__buggpsFlushRecording();
            }))),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Recording acknowledgement timed out')), 2000); }),
          ]);
        } catch {
          recordEvent({ type: 'capture-issue', code: 'recording-connection', message: 'Recording events were not fully acknowledged before finishing; this draft is incomplete.' });
        } finally {
          clearTimeout(timer);
          recordingActive = false;
          await context.close().catch(() => {});
        }
      })();
      await stopPromise;
      return steps.map((s) => ({ ...s }));
    },
  };
}

function addExpectation(result, exp, current) {
  const p = result.expectation;
  const keyOf = (e) => JSON.stringify([e.kind, e.target ?? null]);
  if (CAPTURE_STATE_KINDS.includes(exp.kind)) {
    result.capturedChecks = [...result.capturedChecks.filter((check) => keyOf(check) !== keyOf(exp)), { kind: exp.kind, target: exp.target, observed: current }];
  }
  if (!p || keyOf(p) === keyOf(exp)) {
    result.expectation = exp;
    result.expectedFrom = current ?? null;
    return;
  }
  const key = keyOf(exp);
  result.also = [...result.also.filter((e) => keyOf(e) !== key), exp];
}
