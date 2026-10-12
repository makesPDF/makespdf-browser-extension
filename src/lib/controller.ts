/**
 * The page controller: watches for GitHub's soft navigations, keeps exactly
 * one injected button bound to the current page, and runs the export.
 *
 * GitHub is a Turbo app: the URL changes without a page load and the content
 * area is replaced wholesale. Rather than patching `history` (a content
 * script's patch does not intercept the page's calls), the controller listens
 * for Turbo's own events and re-checks on DOM mutations and a coarse interval.
 * Every check is cheap and idempotent: at most one button exists, and it is
 * replaced when it belongs to a previous URL.
 */

import { findAdapter } from "../adapters/registry";
import { MarkdownFetchError } from "./assets";
import { BUTTON_ID, removeInjected, renderButtonState } from "./button";
import { downloadBase64Pdf, suggestedTitleFromFilename } from "./download";
import { matchGitHubMarkdown } from "./github-url";
import { prepareExportMarkdown } from "./markdown-images";
import { RENDER_MESSAGE_TYPE, type RenderRequest, type RenderResponse } from "./messages";

/** How often the URL is re-checked even without a DOM mutation. */
const POLL_INTERVAL_MS = 1_500;

/** Mutation bursts are coalesced before re-checking. */
const MUTATION_DEBOUNCE_MS = 150;

export interface ControllerOptions {
  document: Document;
  location: Location;
  /** Sends the render request to the background; injected for tests. */
  sendMessage: (request: RenderRequest) => Promise<RenderResponse>;
  /** Page-session fetch; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Wire the controller up. Returns a cleanup function that removes listeners
 * and the injected UI (used by tests; the content script runs for the page's
 * lifetime).
 */
export function startController(options: ControllerOptions): () => void {
  const doc = options.document;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let busy = false;
  let buttonHref: string | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const runExport = async (onClickAdapter: NonNullable<ReturnType<typeof findAdapter>>): Promise<void> => {
    if (busy) return;
    busy = true;
    renderButtonState(doc, "busy");
    try {
      const markdown = await onClickAdapter.getMarkdown();
      const prepared = await prepareExportMarkdown(markdown, (src) => onClickAdapter.resolveAsset(src));
      if (!prepared.ok) {
        renderButtonState(doc, "error", prepared.message);
        return;
      }

      const filename = onClickAdapter.suggestedFilename();
      const response = await options.sendMessage({
        type: RENDER_MESSAGE_TYPE,
        markdown: prepared.markdown,
        title: suggestedTitleFromFilename(filename),
        filename,
      });
      if (!response.ok) {
        renderButtonState(doc, "error", response.message);
        return;
      }

      downloadBase64Pdf(response.base64, response.filename, doc);
      renderButtonState(doc, "ok", `Saved ${response.filename}`);
    } catch (error) {
      renderButtonState(
        doc,
        "error",
        error instanceof MarkdownFetchError
          ? error.message
          : "Could not fetch the Markdown source from GitHub. Reload the page and try again.",
      );
    } finally {
      busy = false;
    }
  };

  const sync = (): void => {
    const href = options.location.href;
    let url: URL | null = null;
    try {
      url = new URL(href);
    } catch {
      url = null;
    }
    if (!url || matchGitHubMarkdown(url) === null) {
      removeInjected(doc);
      buttonHref = null;
      return;
    }

    if (doc.getElementById(BUTTON_ID)) {
      if (buttonHref === href) return; // the button already belongs to this URL
      // A soft navigation kept the header element: the old handler closes over
      // the previous page's target. Replace it.
      removeInjected(doc);
      buttonHref = null;
    }

    const adapter = findAdapter({ url, document: doc, fetchImpl });
    if (!adapter) return;
    if (adapter.injectButton(() => void runExport(adapter))) buttonHref = href;
  };

  const schedule = (): void => {
    if (debounce !== null) return;
    debounce = setTimeout(() => {
      debounce = null;
      sync();
    }, MUTATION_DEBOUNCE_MS);
  };

  const onNavigationEvent = (): void => schedule();
  const onPageShow = (): void => sync();

  doc.addEventListener("turbo:load", onNavigationEvent);
  doc.addEventListener("turbo:render", onNavigationEvent);
  doc.addEventListener("pjax:end", onNavigationEvent);
  globalThis.addEventListener?.("pageshow", onPageShow);
  const observer = new MutationObserver(schedule);
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  const interval = setInterval(sync, POLL_INTERVAL_MS);

  sync();

  return () => {
    doc.removeEventListener("turbo:load", onNavigationEvent);
    doc.removeEventListener("turbo:render", onNavigationEvent);
    doc.removeEventListener("pjax:end", onNavigationEvent);
    globalThis.removeEventListener?.("pageshow", onPageShow);
    observer.disconnect();
    clearInterval(interval);
    if (debounce !== null) clearTimeout(debounce);
    removeInjected(doc);
    buttonHref = null;
  };
}
