/**
 * The render request, run in the background.
 *
 * Only the background can POST to makespdf.com without CORS trouble: it sits
 * on the extension origin with a `makespdf.com` host permission. The call is
 * anonymous unless the user saved an API key in the options — the server's
 * promo carve-out serves anonymous `/md` renders — and the
 * `X-MakesPDF-Client` header labels the build (`+chromium` / `+firefox`).
 */

import { base64FromBytes } from "./bytes";
import { CLIENT_HEADER } from "./build-target";
import { mapFetchError, mapHttpError } from "./errors";
import { sanitizeFilename } from "./github-url";
import type { RenderRequest, RenderResponse } from "./messages";
import { MD_ENDPOINT } from "./service";

/** Whole-request ceiling; the server renders in about a second. */
const RENDER_TIMEOUT_MS = 60_000;

export interface StoredDefaults {
  pageSize?: string;
  theme?: string;
}

export interface RenderDeps {
  fetchImpl: typeof fetch;
  /**
   * The `X-MakesPDF-Client` value; defaults to this bundle's baked header.
   * Injecting it lets the tests pin a header per package.
   */
  clientHeaderValue?: string;
  /** The saved API key, or null when the user has none (anonymous render). */
  getApiKey: () => Promise<string | null>;
  /** Page size / theme defaults from the options page. */
  getStoredDefaults?: () => Promise<StoredDefaults>;
}

/** POST the assembled Markdown to `/api/v1/md` and return the PDF as base64. */
export async function renderMarkdown(input: RenderRequest, deps: RenderDeps): Promise<RenderResponse> {
  const apiKey = await deps.getApiKey();
  const defaults = (await deps.getStoredDefaults?.()) ?? {};

  const options: Record<string, string> = { title: input.title };
  if (defaults.pageSize) options.pageSize = defaults.pageSize;
  if (defaults.theme) options.theme = defaults.theme;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-MakesPDF-Client": deps.clientHeaderValue ?? CLIENT_HEADER,
  };
  // An absent key is the anonymous path; an empty `Bearer ` would read as a
  // failed auth attempt server-side.
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response: Response;
  try {
    response = await deps.fetchImpl(MD_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ markdown: input.markdown, options }),
      signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, ...mapFetchError(error) };
  }

  if (!response.ok) {
    const bodyText = await safeText(response);
    return { ok: false, ...mapHttpError(response.status, bodyText, { hasKey: apiKey !== null }) };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    ok: true,
    base64: base64FromBytes(bytes),
    filename: sanitizeFilename(input.filename),
    pages: response.headers.get("X-Pages"),
    renderMs: response.headers.get("X-Render-Ms"),
  };
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
