/**
 * Save the rendered PDF with an object-URL anchor.
 *
 * An anchor needs no `downloads` permission (and works identically in Chrome
 * and Firefox), which keeps the MVP's permission set minimal. The blob URL is
 * revoked on a delay: revoking immediately can cancel the download in some
 * browsers.
 */

import { bytesFromBase64 } from "./bytes";
import { sanitizeFilename } from "./github-url";

/** The document title for `/md` options: the suggested filename without ".pdf". */
export function suggestedTitleFromFilename(filename: string): string {
  return filename.replace(/\.pdf$/i, "");
}

export function downloadBase64Pdf(base64: string, filename: string, doc: Document): void {
  const bytes = bytesFromBase64(base64);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const anchor = doc.createElement("a");
  anchor.href = url;
  anchor.download = sanitizeFilename(filename);
  anchor.style.display = "none";
  (doc.body ?? doc.documentElement).appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
