/** Base64 ↔ bytes helpers usable in service workers and content scripts alike. */

/**
 * Encode bytes as base64, chunked so large payloads don't blow the call stack.
 *
 * The code units are read into a plain array first: spreading the typed array
 * itself (`String.fromCharCode(...bytes.subarray(…))`) trips Firefox's Xray
 * compartment check inside content scripts with `Permission denied to access
 * property "constructor"` (found by the MAK-200 Firefox smoke).
 */
export function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length);
    const codes: number[] = [];
    for (let j = i; j < end; j++) codes.push(bytes[j] ?? 0);
    binary += String.fromCharCode(...codes);
  }
  return btoa(binary);
}

/** Decode base64 (as produced by `base64FromBytes`) back to bytes. */
export function bytesFromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
