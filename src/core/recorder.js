// Records user actions in a real browser page as replayable steps. An init script listens in
// the capture phase and reports each action with locator candidates (testid > role+name >
// label > #id), computed at event time. Coordinates are never recorded.

import { secretName } from './secrets.js';
import { EnvBlockedError, TestDefinitionError } from './errors.js';

const RECORDER_SCRIPT = String.raw`(() => {
  if (window.__buggpsRecorderInstalled) return;
  window.__buggpsRecorderInstalled = true;
  const send = (ev) => { try { window.__buggpsRecord(ev); } catch {} };
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
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
      if (innerWidth === width && innerHeight === height) return;
      width = innerWidth;
      height = innerHeight;
      send({ type: 'viewport', width, height });
    });
  }

  function roleOf(el) {
    const explicit = el.getAttribute('role');
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
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const by = el.getAttribute('aria-labelledby');
    if (by) return clean(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent).join(' '));
    const label = labelText(el);
    if (label) return label;
    if (['button', 'link', 'heading', 'menuitem', 'menuitemcheckbox', 'tab', 'option', 'radio', 'treeitem', 'switch'].includes(role)) {
      return clean(nameFromContent(el) || el.value);
    }
    if (role === 'img') return clean(el.getAttribute('alt'));
    // Chromium falls back to the placeholder (then title) for unlabeled text inputs.
    if (['textbox', 'searchbox', 'spinbutton', 'combobox'].includes(role)) return clean(el.getAttribute('placeholder') || el.getAttribute('title'));
    return '';
  }

  // Unnamed controls (icon-only buttons) are located inside the nearest named container whose
  // role+name is unique on the page, by position among visible peers with the same role.
  const ANCHOR_ROLES = ['dialog', 'region', 'group', 'listitem', 'row', 'form', 'tabpanel', 'article', 'navigation', 'complementary', 'menu', 'listbox', 'toolbar'];
  const ROLE_TAGS = { button: 'button,input[type=button],input[type=submit],input[type=reset]', link: 'a[href]', textbox: 'input,textarea', checkbox: 'input[type=checkbox]' };
  // Layout visibility only: overlay libraries toggle aria-hidden on everything else while a
  // popover opens/closes, which would make every container look hidden at event time.
  const visible = (n) => n.getClientRects().length > 0 && !n.closest('[hidden]');
  // Innermost elements whose normalized text equals value (what getByText(exact) resolves to).
  const textHits = (root, value) => [...root.querySelectorAll('*')].filter((n) =>
    clean(n.textContent) === value && visible(n) && ![...n.children].some((c) => clean(c.textContent) === value));

  function scoped(el, role, text) {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const ar = roleOf(a);
      if (!ar || !ANCHOR_ROLES.includes(ar)) continue;
      const an = nameOf(a, ar);
      if (!an) continue;
      const sel = '[role=' + ar + ']' + ({ dialog: ',dialog', complementary: ',aside', navigation: ',nav', listitem: ',li', row: ',tr', region: ',section', form: ',form' }[ar] || '');
      const same = [...document.querySelectorAll(sel)].filter((n) => roleOf(n) === ar && nameOf(n, ar) === an && visible(n));
      if (same.length !== 1) continue;
      if (!role) {
        const hits = textHits(a, text);
        const index = hits.findIndex((h) => h === el || el.contains(h));
        if (index >= 0) return { by: 'text', value: text, within: { role: ar, name: an }, index };
        continue;
      }
      const peerSel = '[role=' + role + ']' + (ROLE_TAGS[role] ? ',' + ROLE_TAGS[role] : '');
      const peers = [...a.querySelectorAll(peerSel)].filter((n) => roleOf(n) === role && visible(n));
      const index = peers.indexOf(el);
      if (index >= 0) return { by: 'role', role, within: { role: ar, name: an }, index };
    }
    return null;
  }

  function candidates(el) {
    const out = [];
    const tid = el.getAttribute('data-testid');
    if (tid) out.push({ by: 'testId', value: tid });
    const role = roleOf(el);
    const name = role ? nameOf(el, role) : '';
    if (role && name) out.push({ by: 'role', role, name });
    // Generic names ("Toggle bold" on every option) are told apart by a named image inside.
    const img = role ? el.querySelector('img[alt],[role=img][aria-label]') : null;
    const imgName = img && clean(img.getAttribute('alt') || img.getAttribute('aria-label'));
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
      if (s) out.push(s);
      out.push({ by: 'text', value: text });
    }
    return out;
  }

  // A hover only matters if it alone opened a menu or listbox (tooltips are informational).
  // Any other user action before the popup appears cancels it: then the action opened it.
  const POPUP = '[role=menu],[role=listbox]';
  let lastHover = null;
  let pendingHover = null;
  const cancelHover = () => { if (pendingHover) { pendingHover.disconnect(); pendingHover = null; } };
  window.__buggpsCancelHover = cancelHover;
  document.addEventListener('mouseover', (e) => {
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
      const target = candidates(trigger);
      if (target.length) send({ action: 'hover', target });
    });
    pendingHover = obs;
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { if (pendingHover === obs) cancelHover(); }, 600);
  }, true);
  for (const type of ['pointerdown', 'keydown', 'input']) document.addEventListener(type, cancelHover, true);

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
  const fromToolbar = (e) => e.target instanceof Element && e.target.closest('#__buggps_toolbar');
  let lastApplicationFocus = null;
  document.addEventListener('focusin', (e) => {
    if (!fromToolbar(e) && e.target instanceof HTMLElement) lastApplicationFocus = e.target;
  }, true);

  // Expectation picking: while window.__buggpsPickKind is set, the next click selects an
  // element for the expectation instead of acting on the page (and is not recorded).
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    document.addEventListener(type, (e) => {
      if (window.__buggpsPickKind && !fromToolbar(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
  }

  document.addEventListener('click', (e) => {
    if (fromToolbar(e)) return;
    const kind = window.__buggpsPickKind;
    if (kind) {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.__buggpsPickKind = null;
      const el = e.target instanceof Element ? (e.target.closest('[data-testid]') || e.target) : null;
      if (!el) return;
      const target = candidates(el);
      if (!target.length) target.push({ by: 'text', value: clean(el.textContent).slice(0, 80) });
      if (isSecret(el)) { window.__buggpsToast && window.__buggpsToast('✗ 敏感字段不能作为预期 / not on a secret field'); return; }
      if (kind === 'checkpoint') {
        // "At this point the page shows X": holds before AND after the fix, so a fix cannot
        // skip the situation the user recorded (and shortening cannot drop the step leading here).
        const field = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
        const now = field ? String(el.value ?? '') : clean(el.textContent);
        const ck = field ? 'value' : (now ? 'text' : 'visible');
        const equals = ck === 'visible' ? undefined : window.prompt('BugGPS 检查点 / checkpoint: 此刻应为 / at this point it is:', now);
        if (equals === null) return;
        send({ type: 'checkpoint', check: { kind: ck, target, ...(equals !== undefined ? { equals } : {}) } });
        window.__buggpsToast && window.__buggpsToast('✓ 检查点已记录 / checkpoint set');
        return;
      }
      const current = kind === 'value' ? (el.value ?? '') : clean(el.textContent);
      let equals;
      if (kind === 'text' || kind === 'value') {
        equals = window.prompt('BugGPS: 现在显示 / now shows: "' + current + '"\n正确应为 / should be:', current);
        if (equals === null) return;
      }
      send({ type: 'expect', expectation: { kind, target, ...(equals !== undefined ? { equals } : {}) }, current });
      window.__buggpsToast && window.__buggpsToast('✓ 预期已记录 / expectation set');
      return;
    }
    const el = e.target instanceof Element ? clickTarget(e.target) : null;
    if (!el) return;
    send({ action: 'click', target: candidates(el) });
  }, true);

  // The NEAREST clickable ancestor wins: a standard role, or an onclick property (React sets a
  // no-op one on non-interactive elements that have onClick). A custom select inside a
  // draggable row (role=button) must resolve to the select, not the row. Fallback: outermost
  // element of a contiguous pointer-cursor chain (cursor is inherited by children).
  function clickTarget(node) {
    let pointer = null;
    for (let el = node; el && el !== document.body; el = el.parentElement) {
      if (el.matches(CLICKABLE)) return el;
      if (el.matches('[role=dialog],[role=none],[role=presentation]')) break;
      if (el.onclick) return el;
      if (getComputedStyle(el).cursor === 'pointer') pointer = el;
      else if (pointer) break;
    }
    return pointer || node.closest(CLICKABLE);
  }

  document.addEventListener('input', (e) => {
    if (fromToolbar(e)) return;
    const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    if (['checkbox', 'radio'].includes(el.type)) return;
    const identity = identityOf(el);
    if (isSecret(el)) { send({ action: 'fill', target: candidates(el), secret: secretLabel(el), identity }); return; }
    send({ action: 'fill', target: candidates(el), value: el.value, identity });
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el instanceof HTMLSelectElement) send({ action: 'select', target: candidates(el), value: el.value });
    else if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) send({ action: 'check', target: candidates(el), value: el.checked });
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && window.__buggpsPickKind) {
      window.__buggpsPickKind = null;
      e.preventDefault();
      e.stopImmediatePropagation();
      const focused = e.composedPath()[0];
      if (fromToolbar(e) && focused instanceof HTMLElement) focused.blur();
      if (lastApplicationFocus?.isConnected) lastApplicationFocus.focus({ preventScroll: true });
      window.__buggpsToast && window.__buggpsToast('已取消选择 / selection cancelled');
      return;
    }
    if (fromToolbar(e)) return;
    const el = e.target;
    if (e.key === 'Enter' && (el instanceof HTMLInputElement)) send({ action: 'press', target: candidates(el), value: 'Enter' });
    // Escape closes popovers/dialogs wherever focus is; replay presses it page-wide.
    else if (e.key === 'Escape') send({ action: 'key', target: [{ by: 'page' }], value: 'Escape' });
  }, true);
})();`;

// Floating toolbar for headed recording, in a shadow root so page styles do not leak in.
const TOOLBAR_SCRIPT = String.raw`(() => {
  const mount = () => {
    if (document.getElementById('__buggps_toolbar') || !document.body) return;
    const host = document.createElement('div');
    host.id = '__buggps_toolbar';
    host.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>div{font:12px system-ui;background:#111;color:#fff;border-radius:8px;padding:8px;display:flex;gap:6px;flex-wrap:wrap;max-width:420px;box-shadow:0 2px 8px #0006}button{font:12px system-ui;border:0;border-radius:6px;padding:5px 8px;cursor:pointer;background:#2d6cdf;color:#fff}button.stop{background:#c0392b}span{width:100%;opacity:.8}</style>'
      + '<div><span id="msg">● BugGPS 录制中 / recording</span>'
      + '<button data-k="text">预期文本 text</button><button data-k="value">预期输入值 value</button>'
      + '<button data-k="visible">应可见 visible</button><button data-k="hidden">应消失 hidden</button>'
      + '<button data-k="no-page-error">不应报错 no error</button>'
      + '<button data-k="checkpoint" title="点选元素：记录此刻它的内容，修复后这一步也必须一样 / the page must look like this at this point, before and after the fix">✓ 此刻应为 checkpoint</button>'
      + '<button class="pin" title="缩减时永远保留上一步 / never delete the last step when shortening">⚑ 上一步是关键 key step</button>'
      + '<button class="stop">■ 结束 stop</button></div>';
    const msg = root.getElementById('msg');
    window.__buggpsToast = (t) => { msg.textContent = t; };
    root.querySelectorAll('button[data-k]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k;
      if (k === 'no-page-error') {
        window.__buggpsPickKind = null;
        window.__buggpsRecord({ type: 'expect', expectation: { kind: k } });
        msg.textContent = '✓ 不应报错。再用「应可见 / 预期文本」标出正确结果 / now also mark what SHOULD show';
        return;
      }
      window.__buggpsPickKind = k;
      msg.textContent = '点选页面元素 / click an element (' + k + ')';
    }));
    root.querySelector('.pin').addEventListener('click', () => {
      window.__buggpsRecord({ type: 'pin' });
      msg.textContent = '⚑ 已标记关键步骤 / key step pinned';
    });
    root.querySelector('.stop').addEventListener('click', () => {
      window.__buggpsPickKind = null;
      msg.textContent = '已结束 / stopped';
      window.__buggpsRecord({ type: 'stop' });
    });
    document.documentElement.appendChild(host);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
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
  const result = { expectation: null, also: [], expectedFrom: null };
  let finish;
  const finished = new Promise((r) => { finish = r; });
  let lastFillIdentity = null;
  const secretFields = new Map();
  const secretNames = new Set();
  await context.exposeBinding('__buggpsRecord', (_src, ev) => {
    if (ev?.type) lastFillIdentity = null;
    if (ev?.type === 'expect') { addExpectation(result, ev.expectation, ev.current); return; }
    if (ev?.type === 'checkpoint') { steps[steps.length - 1].check = ev.check; return; }
    if (ev?.type === 'stop') { finish('stop'); return; }
    if (ev?.type === 'pin') { if (steps.length > 1) steps[steps.length - 1].pinned = true; return; }
    if (ev?.type === 'viewport') { steps.push({ action: 'viewport', width: ev.width, height: ev.height, pinned: true }); return; }
    if (!ev?.target?.length) { dropped.push(ev); return; }
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
      ev = { action: ev.action, target: ev.target, value: { secret: secretFields.get(field) } };
    }
    const prev = steps[steps.length - 1];
    if (ev.action === 'fill' && prev?.action === 'fill' && identity && identity === lastFillIdentity && !prev.check && !prev.pinned) {
      prev.value = ev.value; // one human "type into field" action, not one step per keystroke
      return;
    }
    steps.push(ev);
    lastFillIdentity = ev.action === 'fill' ? identity : null;
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
  let stopped = false;
  return {
    page,
    steps,
    dropped,
    result,
    finished,
    async stop() {
      if (!stopped) {
        stopped = true;
        // Let in-flight binding calls land before closing.
        await page.waitForTimeout(100).catch(() => {});
        await context.close().catch(() => {});
      }
      return steps.map((s) => ({ ...s }));
    },
  };
}

function addExpectation(result, exp, current) {
  const p = result.expectation;
  const keyOf = (e) => JSON.stringify([e.kind, e.target ?? null]);
  if (!p || keyOf(p) === keyOf(exp)) {
    result.expectation = exp;
    result.expectedFrom = current ?? null;
    return;
  }
  const key = keyOf(exp);
  result.also = [...result.also.filter((e) => keyOf(e) !== key), exp];
}
