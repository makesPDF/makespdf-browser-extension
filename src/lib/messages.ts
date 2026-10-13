/**
 * Shared message shapes between the content script and the background.
 *
 * The content script assembles the final Markdown (relative images already
 * inlined as `data:` URIs) and asks the background to POST it, because only
 * the background sits on the extension origin with a `makespdf.com` host
 * permission — a content-script fetch would be subject to GitHub's CORS.
 */

import type { RenderErrorKind } from "./errors";

export const RENDER_MESSAGE_TYPE = "makespdf:render" as const;

export interface RenderRequest {
  type: typeof RENDER_MESSAGE_TYPE;
  markdown: string;
  /** Document title for `/md` options, the file stem (no extension). */
  title: string;
  /** Suggested download filename, e.g. "README.pdf". */
  filename: string;
}

export interface RenderSuccess {
  ok: true;
  /** The PDF bytes, base64-encoded. */
  base64: string;
  /** Sanitized filename the content script should save as. */
  filename: string;
  /** `X-Pages` response header, when the server sent one. */
  pages: string | null;
  /** `X-Render-Ms` response header, when the server sent one. */
  renderMs: string | null;
}

export interface RenderFailure {
  ok: false;
  kind: RenderErrorKind;
  message: string;
}

export type RenderResponse = RenderSuccess | RenderFailure;
