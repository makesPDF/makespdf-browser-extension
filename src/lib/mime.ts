/** Content-type helpers for fetched assets. */

/** File-extension → MIME map, the same set the VS Code plugin embeds. */
export const IMAGE_MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".apng": "image/apng",
};

/** The MIME type for a URL path's extension, or null when unknown. */
export function mimeFromPath(path: string): string | null {
  const leaf = path.split("/").pop() ?? "";
  const dot = leaf.lastIndexOf(".");
  if (dot < 0) return null;
  return IMAGE_MIME_BY_EXT[leaf.slice(dot).toLowerCase()] ?? null;
}

/** Lowercase a Content-Type and drop its parameters; null when empty. */
export function normalizeContentType(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.split(";")[0]?.trim().toLowerCase() ?? "";
  return value.length > 0 ? value : null;
}

/**
 * The content type to store an image under: the response's own `image/*`
 * type when it has one (it can differ from the extension), otherwise the
 * extension's type (GitHub serves some SVGs as `text/plain`), otherwise null.
 */
export function pickImageMime(contentType: string | null, path: string): string | null {
  const normalized = normalizeContentType(contentType);
  if (normalized && normalized.startsWith("image/")) return normalized;
  return mimeFromPath(path);
}
