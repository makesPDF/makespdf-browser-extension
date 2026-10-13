/**
 * Find relative image references in Markdown and inline them as `data:` URIs
 * before the export is sent to makesPDF.
 *
 * Follows the VS Code plugin's MAK-191 precedent: a PDF silently missing an
 * image is worse than no PDF, so any reference that cannot be embedded stops
 * the export with a message naming the reference(s). References inside fenced
 * code blocks and inline code spans are literal text and are never touched.
 *
 * The server's `/md` image rules are mirrored here: at most 20 images are
 * embedded per document and at most 5 MB per image; anything over is a stop,
 * not a silent drop.
 */

import { AssetError } from "./assets";

/** The service's per-image cap; a larger asset would be skipped server-side. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The service's per-document image cap (`MAX_IMAGE_COUNT` server-side). */
export const MAX_IMAGE_COUNT = 20;

/** At most this many failed references are named; the rest are counted. */
const MAX_NAMED_FAILURES = 10;

export interface ImageFailure {
  /** The reference as written, minus `<…>` brackets and surrounding space. */
  src: string;
  /** Short reason, e.g. "could not be fetched (HTTP 404)". */
  reason: string;
}

export interface InlineResult {
  markdown: string;
  /** References that could not be embedded, in document order. */
  failures: ImageFailure[];
}

export type PreparedExport =
  | { ok: true; markdown: string }
  | { ok: false; message: string };

// Markdown image: ![alt](src "optional title"). Group 2 is the src (possibly
// wrapped in <…>); group 3 is the optional title with its leading whitespace.
const MD_IMAGE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)((?:\s+(?:"[^"]*"|'[^']*'))?)\s*\)/g;
// HTML <img …src="…">. Group 1 is everything up to and including `src=`,
// group 3/4 is the quoted value (double/single). `[\s/]+` before `src`, not a
// bare `\b`, so `data-src=` is not mistaken for the real attribute.
const HTML_IMAGE_SRC = /(<img\b[^>]*?[\s/]+src\s*=\s*)("([^"]*)"|'([^']*)')/gi;

/**
 * Whether a src is a path relative to the repository. Skips anything with a
 * URL scheme (http:, https:, data:, mailto:), protocol-relative (`//host/x`)
 * and fragment-only refs. Those are left for the server (or the renderer), not
 * fetched through the user's session.
 */
export function isRelativeAsset(src: string): boolean {
  if (!src) return false;
  if (/^[a-z][a-z0-9+.-]+:/i.test(src)) return false;
  if (src.startsWith("//") || src.startsWith("#")) return false;
  return true;
}

/** Strip surrounding <…> angle brackets and whitespace from a src token. */
function cleanSrc(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1).trim() : trimmed;
}

/**
 * Replace fenced code blocks and inline code spans with sentinel tokens so the
 * image scan never touches them, returning a `restore` to swap them back in.
 */
function maskCode(input: string): { masked: string; restore: (value: string) => string } {
  const stash: string[] = [];
  const keep = (match: string) => {
    const token = `\u0000CODE${stash.length}\u0000`;
    stash.push(match);
    return token;
  };
  const masked = input
    .replace(/```[\s\S]*?```/g, keep)
    .replace(/~~~[\s\S]*?~~~/g, keep)
    .replace(/``[^`]*``/g, keep)
    .replace(/`[^`\n]*`/g, keep);
  const restore = (value: string) =>
    value.replace(/\u0000CODE(\d+)\u0000/g, (_token, index: string) => stash[Number(index)] ?? "");
  return { masked, restore };
}

/**
 * All image src tokens in document order, code masked out. The two syntaxes
 * are scanned separately, then merged by position so order (and therefore
 * which failures are named first) follows the document even when Markdown and
 * HTML references interleave.
 */
function collectRefs(source: string): { masked: string; restore: (value: string) => string; refs: string[] } {
  const { masked, restore } = maskCode(source);
  const found: { index: number; src: string }[] = [];
  for (const match of masked.matchAll(MD_IMAGE)) {
    found.push({ index: match.index, src: cleanSrc(match[2] ?? "") });
  }
  for (const match of masked.matchAll(HTML_IMAGE_SRC)) {
    found.push({ index: match.index, src: cleanSrc(match[3] ?? match[4] ?? "") });
  }
  found.sort((a, b) => a.index - b.index);
  return { masked, restore, refs: found.map((entry) => entry.src) };
}

/**
 * Unique image references in document order, whatever their scheme — these
 * are the `img` srcs the server sees after the export, so they are also the
 * ones its per-document image cap counts.
 */
export function collectImageRefs(source: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ref of collectRefs(source).refs) {
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    out.push(ref);
  }
  return out;
}

/** Unique relative image references, in document order. */
export function findRelativeRefs(source: string): string[] {
  return collectImageRefs(source).filter(isRelativeAsset);
}

/**
 * Replace relative image references with base64 `data:` URIs produced by
 * `resolve`. Rejections carrying an `AssetError` name their reason; anything
 * else is reported as "could not be fetched".
 */
export async function inlineRelativeImages(
  source: string,
  resolve: (src: string) => Promise<string>,
): Promise<InlineResult> {
  const { masked, restore, refs } = collectRefs(source);
  const candidates = findRelativeRefs(source);

  const uris = new Map<string, string>();
  const failureByRef = new Map<string, string>();
  await Promise.all(
    candidates.map(async (src) => {
      try {
        uris.set(src, await resolve(src));
      } catch (error) {
        failureByRef.set(src, error instanceof AssetError ? error.reason : "could not be fetched");
      }
    }),
  );

  const failures: ImageFailure[] = candidates
    .filter((src) => failureByRef.has(src))
    .map((src) => ({ src, reason: failureByRef.get(src) ?? "could not be fetched" }));

  if (uris.size === 0) return { markdown: source, failures };

  let out = masked.replace(MD_IMAGE, (whole, alt: string, url: string, title: string | undefined) => {
    const uri = uris.get(cleanSrc(url));
    return uri ? `![${alt}](${uri}${title ?? ""})` : whole;
  });
  out = out.replace(HTML_IMAGE_SRC, (whole, prefix: string, _quoted: string, doubleQuoted: string | undefined, singleQuoted: string | undefined) => {
    const uri = uris.get(cleanSrc(doubleQuoted ?? singleQuoted ?? ""));
    if (!uri) return whole;
    const quote = doubleQuoted !== undefined ? '"' : "'";
    return `${prefix}${quote}${uri}${quote}`;
  });

  return { markdown: restore(out), failures };
}

/**
 * The error that stops an export, or null when every relative image embedded.
 * Names each failed reference (up to MAX_NAMED_FAILURES) with its reason.
 */
export function formatImageFailure(failures: ImageFailure[]): string | null {
  if (failures.length === 0) return null;
  const names = failures
    .slice(0, MAX_NAMED_FAILURES)
    .map((failure) => `${failure.src} (${failure.reason})`);
  const more = failures.length - names.length;
  const listed = more > 0 ? `${names.join(", ")} and ${more} more` : names.join(", ");
  const one = failures.length === 1;
  return (
    `Export stopped, no PDF was written: ${failures.length} ` +
    `image${one ? "" : "s"} could not be embedded: ${listed}. ` +
    `Fix or remove ${one ? "the reference" : "these references"} and export again.`
  );
}

/**
 * The pre-flight every export runs: enforce the document cap, inline relative
 * images, and report a stop message when any could not be embedded. A caller
 * with `ok: false` must not send a request: a PDF silently missing an image is
 * worse than no PDF.
 */
export async function prepareExportMarkdown(
  source: string,
  resolve: (src: string) => Promise<string>,
): Promise<PreparedExport> {
  // The server's cap counts every image src in the document (inlined data:
  // URIs and absolute URLs included) and drops the ones past it without a
  // trace, so the pre-flight counts the same set: relative and absolute.
  const refs = collectImageRefs(source);
  if (refs.length > MAX_IMAGE_COUNT) {
    return {
      ok: false,
      message:
        `Export stopped, no PDF was written: the document references ${refs.length} ` +
        `images, but at most ${MAX_IMAGE_COUNT} can be embedded per document. ` +
        "Remove some images and export again.",
    };
  }

  const { markdown, failures } = await inlineRelativeImages(source, resolve);
  const error = formatImageFailure(failures);
  return error ? { ok: false, message: error } : { ok: true, markdown };
}
