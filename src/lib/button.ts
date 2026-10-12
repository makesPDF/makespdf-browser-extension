/**
 * The injected "Download PDF" button and its status line.
 *
 * Injection is idempotent by element id — the controller checks before calling
 * and this module removes any existing instance first, so a soft navigation
 * can never leave two buttons. On blob views the button sits in the file
 * header beside GitHub's Raw link; on a repo home page (no header to join) it
 * floats bottom-right. All styling is inline, so GitHub's CSS cannot restyle
 * it and the extension ships no stylesheet for the page.
 */

import type { GitHubMarkdownTarget } from "./github-url";

export const BUTTON_ID = "makespdf-download-pdf-button";
export const STATUS_ID = "makespdf-download-pdf-status";
export const FLOATING_HOST_ID = "makespdf-download-pdf-host";

const BUTTON_TEXT = "Download PDF";

const BUTTON_STYLE = [
  "font: 600 12px/20px -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif",
  "color: #24292f",
  "background-color: #f6f8fa",
  "border: 1px solid rgba(31, 35, 40, 0.15)",
  "border-radius: 6px",
  "padding: 3px 12px",
  "cursor: pointer",
  "margin-right: 8px",
  "white-space: nowrap",
].join(";");

const STATUS_STYLE = [
  "font: 400 12px/20px -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif",
  "color: #57606a",
  "margin-right: 8px",
  "max-width: 480px",
].join(";");

const FLOATING_STYLE = [
  "position: fixed",
  "right: 24px",
  "bottom: 24px",
  "z-index: 2147483647",
  "display: flex",
  "align-items: center",
  "gap: 8px",
  "background: #ffffff",
  "border: 1px solid rgba(31, 35, 40, 0.15)",
  "border-radius: 8px",
  "padding: 6px 8px",
  "box-shadow: 0 2px 8px rgba(31, 35, 40, 0.15)",
].join(";");

export type ButtonState = "idle" | "busy" | "ok" | "error";

/** Remove every element this extension injected into the page. */
export function removeInjected(doc: Document): void {
  for (const id of [BUTTON_ID, STATUS_ID, FLOATING_HOST_ID]) {
    doc.getElementById(id)?.remove();
  }
}

interface InsertionPoint {
  parent: Element;
  before: Node | null;
}

/** The header container to join, or null when the page offers none. */
function findBlobHost(doc: Document): InsertionPoint | null {
  const raw = findRawLink(doc);
  if (!raw) return null;
  // New React blob UI: the Raw link sits in a ButtonGroup; join the group's
  // parent so we render as a sibling of the group, not inside it.
  const group = raw.closest('[data-component="ButtonGroup"]');
  if (group?.parentElement) return { parent: group.parentElement, before: group };
  const actions = raw.closest(".react-blob-header-edit-and-raw-actions");
  if (actions) return { parent: actions, before: actions.firstChild };
  return raw.parentElement ? { parent: raw.parentElement, before: raw } : null;
}

/** GitHub's Raw link for the current file, across old and new blob UIs. */
function findRawLink(doc: Document): HTMLAnchorElement | null {
  const candidates = doc.querySelectorAll<HTMLAnchorElement>(
    'a[data-testid="raw-button"], a#raw-url, a[href*="/raw/"]',
  );
  for (const anchor of candidates) {
    const attribute = anchor.getAttribute("href") ?? "";
    if (/^\/[^/]+\/[^/]+\/raw\//.test(attribute)) return anchor;
    if (/^https:\/\/github\.com\/[^/]+\/[^/]+\/raw\//.test(anchor.href)) return anchor;
  }
  return null;
}

/** Whether a README is rendered on this page (repo home). */
function hasRenderedReadme(doc: Document): boolean {
  return doc.querySelector('#readme, [data-testid="readme"], .markdown-body') !== null;
}

/**
 * Inject the button for `target`, bound to `onClick`. Returns false when the
 * page has no sensible home for it yet (repo home before the README renders) —
 * the controller retries on the next DOM change.
 */
export function injectDownloadButton(
  doc: Document,
  target: GitHubMarkdownTarget,
  onClick: () => void,
): boolean {
  removeInjected(doc);

  const button = doc.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.textContent = BUTTON_TEXT;
  button.style.cssText = BUTTON_STYLE;
  button.addEventListener("click", onClick);

  const status = doc.createElement("span");
  status.id = STATUS_ID;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.style.cssText = STATUS_STYLE;

  const host = findBlobHost(doc);
  if (host) {
    host.parent.insertBefore(button, host.before);
    host.parent.insertBefore(status, host.before);
    return true;
  }

  // Repo home (or a blob view whose header is not rendered yet): float.
  if (target.kind === "home" && !hasRenderedReadme(doc)) return false;
  const floating = doc.createElement("div");
  floating.id = FLOATING_HOST_ID;
  floating.style.cssText = FLOATING_STYLE;
  floating.append(status, button);
  (doc.body ?? doc.documentElement).appendChild(floating);
  return true;
}

/** Update the button and status line for a state change. */
export function renderButtonState(doc: Document, state: ButtonState, message?: string): void {
  const button = doc.getElementById(BUTTON_ID);
  if (button instanceof HTMLButtonElement) {
    button.disabled = state === "busy";
    button.textContent = state === "busy" ? "Rendering PDF…" : BUTTON_TEXT;
    button.style.opacity = state === "busy" ? "0.6" : "1";
  }
  const status = doc.getElementById(STATUS_ID);
  if (status) {
    status.textContent = message ?? "";
    status.style.color = state === "error" ? "#cf222e" : state === "ok" ? "#1a7f37" : "#57606a";
  }
}
