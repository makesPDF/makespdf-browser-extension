/**
 * The GitHub adapter: the first (and for the MVP, only) Markdown source.
 *
 * The Markdown fetch and every image fetch run in the content script with
 * `credentials: "same-origin"`, so the page's cookies ride along — that is
 * what makes private repositories work. The raw route 302s to a tokenized
 * raw.githubusercontent.com URL; the fetch follows it (raw.githubusercontent.com
 * sends `access-control-allow-origin: *`, verified), and the token in the URL
 * carries authorization for private repos.
 */

import { AssetError, MarkdownFetchError } from "../lib/assets";
import { base64FromBytes } from "../lib/bytes";
import { injectDownloadButton } from "../lib/button";
import { boundFetch, type FetchLike } from "../lib/fetch";
import {
  matchGitHubMarkdown,
  sanitizeFilename,
  type GitHubMarkdownTarget,
} from "../lib/github-url";
import { MAX_IMAGE_BYTES } from "../lib/markdown-images";
import { pickImageMime } from "../lib/mime";
import type { AdapterContext, AdapterFactory, MarkdownAdapter } from "./types";

const FETCH_TIMEOUT_MS = 15_000;

export class GitHubMarkdownAdapter implements MarkdownAdapter {
  private readonly target: GitHubMarkdownTarget;
  private readonly document: Document;
  private readonly fetchImpl: FetchLike;

  constructor(target: GitHubMarkdownTarget, context: Pick<AdapterContext, "document" | "fetchImpl">) {
    this.target = target;
    this.document = context.document;
    // Bound here: calling `this.fetchImpl(…)` would otherwise invoke native
    // fetch with the adapter as `this` and throw Illegal invocation.
    this.fetchImpl = boundFetch(context.fetchImpl);
  }

  matches(url: URL): boolean {
    return matchGitHubMarkdown(url) !== null;
  }

  /**
   * Fetch the raw Markdown through the page's session. Never scrapes the
   * rendered page. The repo home tries README.md then README.markdown; a blob
   * view fetches its own raw URL (which works for any ref, including tags and
   * SHAs, and for refs containing slashes — GitHub resolves them server-side).
   */
  async getMarkdown(): Promise<string> {
    const urls =
      this.target.kind === "home"
        ? [this.target.rawUrl, this.target.rawUrl.replace(/README\.md$/i, "README.markdown")]
        : [this.target.rawUrl];

    for (const url of urls) {
      const response = await this.fetchWithTimeout(url);
      if (response.ok) return await response.text();
      if (response.status !== 404) {
        throw new MarkdownFetchError(`GitHub returned HTTP ${response.status} for this file. Reload the page and try again.`);
      }
    }
    throw new MarkdownFetchError(
      this.target.kind === "home"
        ? "No README.md was found in this repository."
        : "The file could not be fetched from GitHub (HTTP 404).",
    );
  }

  /**
   * Fetch one relative reference through the page's session and return it as
   * a `data:` URI. Leading "/" is repository-root-relative; everything else is
   * resolved against the source file's directory (`..`, `./`, nested dirs).
   */
  async resolveAsset(relativePath: string): Promise<string> {
    const base = relativePath.startsWith("/") ? this.target.rootRawDirUrl : this.target.rawDirUrl;
    const relative = relativePath.replace(/^\/+/, "");

    let resolved: URL;
    try {
      resolved = new URL(relative, base);
    } catch {
      throw new AssetError("is not a valid path", relativePath);
    }
    resolved.search = "";
    resolved.hash = "";
    if (!this.isInsideRepository(resolved)) {
      throw new AssetError("points outside the repository", relativePath);
    }

    let response: Response;
    try {
      response = await this.fetchWithTimeout(resolved.toString());
    } catch {
      throw new AssetError("could not be fetched", relativePath);
    }
    if (!response.ok) {
      throw new AssetError(`could not be fetched (HTTP ${response.status})`, relativePath);
    }

    // Refuse before downloading when the server declares an oversized file.
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
      throw new AssetError("too large to embed, max 5MB", relativePath);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new AssetError("too large to embed, max 5MB", relativePath);
    }

    const mime = pickImageMime(response.headers.get("content-type"), resolved.pathname);
    if (!mime) {
      throw new AssetError("is not an image", relativePath);
    }
    return `data:${mime};base64,${base64FromBytes(bytes)}`;
  }

  injectButton(onClick: () => void): boolean {
    return injectDownloadButton(this.document, this.target, onClick);
  }

  suggestedFilename(): string {
    return sanitizeFilename(this.target.filename);
  }

  private isInsideRepository(resolved: URL): boolean {
    return (
      resolved.protocol === "https:" &&
      resolved.hostname === "github.com" &&
      resolved.pathname.startsWith(`/${this.target.owner}/${this.target.repo}/raw/`)
    );
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    return await this.fetchImpl(url, {
      credentials: "same-origin",
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  }
}

export const githubAdapterFactory: AdapterFactory = {
  id: "github",
  matches(url: URL): boolean {
    return matchGitHubMarkdown(url) !== null;
  },
  create(context: AdapterContext): MarkdownAdapter {
    const target = matchGitHubMarkdown(context.url);
    if (!target) throw new Error("github adapter created for a non-matching URL");
    return new GitHubMarkdownAdapter(target, context);
  },
};
