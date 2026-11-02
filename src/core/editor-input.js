import { TestDefinitionError } from './errors.js';

export const MAX_EDITOR_CLIPBOARD_BYTES = 1024 * 1024;
export const CODE_EDITOR_SELECTOR = '.monaco-editor,.CodeMirror,.cm-editor,.ace_editor';

export function validatePasteStep(step) {
  if (step.editor !== 'monaco' || step.mode !== 'replace-all') throw new TestDefinitionError('Editor paste requires editor="monaco" and mode="replace-all"');
  if (typeof step.value !== 'string' && !(step.value && typeof step.value.secret === 'string')) throw new TestDefinitionError('Editor paste needs text or a secret reference');
  if (step.clipboard !== undefined) {
    if (!Array.isArray(step.clipboard) || !step.clipboard.length || step.clipboard.length > 32) throw new TestDefinitionError('Editor paste clipboard must list 1 to 32 string formats');
    const types = new Set();
    for (const format of step.clipboard) {
      if (!format || typeof format.type !== 'string' || !format.type || format.type.length > 128 || format.type.toLowerCase() !== format.type || format.type === 'files' || types.has(format.type)) throw new TestDefinitionError('Editor paste clipboard format is invalid or duplicated');
      types.add(format.type);
      if (format.type === 'text/plain' ? format.value !== undefined : typeof format.value !== 'string') throw new TestDefinitionError('Editor paste clipboard format needs a string value; plain text uses the step value');
    }
    if (!types.has('text/plain')) throw new TestDefinitionError('Editor paste clipboard must include text/plain');
    if (typeof step.value !== 'string' && types.size > 1) throw new TestDefinitionError('Secret editor paste supports plain text only');
  }
  validateClipboardSize([...(typeof step.value === 'string' ? [step.value] : []), ...(step.clipboard ?? []).flatMap((format) => format.value === undefined ? [] : [format.value])]);
}

function validateClipboardSize(values) {
  let bytes = 0;
  for (const value of values) {
    if (value.length > MAX_EDITOR_CLIPBOARD_BYTES || (bytes += Buffer.byteLength(value)) > MAX_EDITOR_CLIPBOARD_BYTES) throw new TestDefinitionError('Editor clipboard exceeds the 1 MiB limit');
  }
}

// Replays captured string formats, preserving their order. It never reads or changes
// the system clipboard, and requires the editor's own paste handler to consume the event.
export async function replaceEditorByPaste(locator, text, { timeout, signal, clipboard } = {}) {
  validateClipboardSize([text, ...(clipboard ?? []).flatMap((format) => format.value === undefined ? [] : [format.value])]);
  const state = await locator.evaluate((element) => ({
    supported: element instanceof HTMLTextAreaElement && Boolean(element.closest('.monaco-editor')),
    blocked: element.disabled || element.readOnly || element.getAttribute('aria-readonly') === 'true',
  }));
  if (!state.supported) throw new TestDefinitionError('Editor paste target is not a supported Monaco textarea');
  if (state.blocked) return { disabled: true };
  if (signal?.aborted) return {};
  await locator.press('ControlOrMeta+A', { timeout });
  if (signal?.aborted) return {};
  const handled = await locator.evaluate((element, payload) => {
    if (element.disabled || element.readOnly || element.getAttribute('aria-readonly') === 'true') return { blocked: true };
    const clipboardData = new DataTransfer();
    for (const format of payload.clipboard ?? [{ type: 'text/plain' }]) clipboardData.setData(format.type, format.type === 'text/plain' ? payload.text : format.value);
    const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return { consumed: event.defaultPrevented };
  }, { text, clipboard });
  if (handled.blocked) return { disabled: true };
  if (!handled.consumed) throw new TestDefinitionError('Editor paste was not handled; this editor does not support clipboard-event replay');
  return {};
}
