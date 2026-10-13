/**
 * Fetch plumbing.
 *
 * Native `fetch` is unforgiving about its receiver: calling `deps.fetchImpl(…)`
 * or `this.fetchImpl(…)` invokes it with the wrong `this` and throws
 * `TypeError: Illegal invocation` in workers. Every fetch handed to, or used
 * by, this extension is bound to the global scope exactly once here.
 */

export type FetchLike = typeof fetch;

/** `fetchImpl` bound to the global scope, falling back to the ambient fetch. */
export function boundFetch(fetchImpl?: FetchLike): FetchLike {
  return (fetchImpl ?? globalThis.fetch).bind(globalThis);
}
