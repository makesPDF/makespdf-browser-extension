/** Thrown when a page's Markdown source itself cannot be fetched. */
export class MarkdownFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkdownFetchError";
  }
}

/** The standard error an adapter throws when a referenced asset cannot be embedded. */
export class AssetError extends Error {
  /** Short reason shown to the user, e.g. "could not be fetched (HTTP 404)". */
  readonly reason: string;
  /** The reference as written in the document. */
  readonly src: string;

  constructor(reason: string, src: string) {
    super(`${src}: ${reason}`);
    this.name = "AssetError";
    this.reason = reason;
    this.src = src;
  }
}
