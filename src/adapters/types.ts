/**
 * The per-page adapter interface. MAK-197 adds further adapters (GitLab,
 * Bitbucket, ...) as additive factories over this same shape: URL matching,
 * Markdown source, asset resolution, button injection, filename.
 */

import type { FetchLike } from "../lib/fetch";

export interface AdapterContext {
  /** The page URL the adapter was created for. */
  url: URL;
  /** The page document, for button injection. */
  document: Document;
  /** `fetch` bound to the page's session; injected for tests. */
  fetchImpl: FetchLike;
}

export interface MarkdownAdapter {
  /** Whether this adapter serves `url`. */
  matches(url: URL): boolean;
  /** The page's Markdown source, fetched through the user's session. */
  getMarkdown(): Promise<string>;
  /**
   * Resolve one relative asset reference to an embeddable data URI, e.g. a
   * `data:image/png;base64,…` string. Rejects with `AssetError` when the
   * asset cannot be embedded (fetch failure, size, content type).
   */
  resolveAsset(relativePath: string): Promise<string>;
  /** Inject the adapter's call-to-action; false when the page has no home for it yet. */
  injectButton(onClick: () => void): boolean;
  /** The filename the rendered PDF should be saved as. */
  suggestedFilename(): string;
}

export interface AdapterFactory {
  readonly id: string;
  matches(url: URL): boolean;
  create(context: AdapterContext): MarkdownAdapter;
}
