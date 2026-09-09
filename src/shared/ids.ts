/** `crypto.randomUUID` requires a secure context, which http:// pages are not. */
export function randomId(prefix = ''): string {
  const uuid = globalThis.crypto?.randomUUID;
  if (typeof uuid === 'function') return `${prefix}${uuid.call(globalThis.crypto)}`;
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
