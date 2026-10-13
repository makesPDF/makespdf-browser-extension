// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUTTON_ID, FLOATING_HOST_ID, STATUS_ID, injectDownloadButton, removeInjected, renderButtonState } from "../src/lib/button";
import { matchGitHubMarkdown, type GitHubMarkdownTarget } from "../src/lib/github-url";

function target(url: string): GitHubMarkdownTarget {
  const matched = matchGitHubMarkdown(url);
  if (!matched) throw new Error(`not a target: ${url}`);
  return matched;
}

const BLOB_TARGET = target("https://github.com/acme/docs/blob/main/readme.md");
const HOME_TARGET = target("https://github.com/acme/docs");

function blobDom(): void {
  document.body.innerHTML = `
    <div class="react-blob-header-edit-and-raw-actions">
      <div data-component="ButtonGroup">
        <a data-testid="raw-button" href="/acme/docs/raw/refs/heads/main/readme.md">Raw</a>
      </div>
    </div>`;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("injectDownloadButton", () => {
  it("joins the blob header next to the Raw button", () => {
    blobDom();
    const onClick = vi.fn();
    expect(injectDownloadButton(document, BLOB_TARGET, onClick)).toBe(true);

    const button = document.getElementById(BUTTON_ID);
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe("Download PDF");
    expect(document.getElementById(STATUS_ID)).not.toBeNull();
    expect(document.getElementById(FLOATING_HOST_ID)).toBeNull();

    // Rendered as a sibling immediately before GitHub's button group, so the
    // button and status sit left of GitHub's actions without breaking them.
    const group = document.querySelector('[data-component="ButtonGroup"]');
    expect(button?.nextElementSibling?.id).toBe(STATUS_ID);
    expect(button?.parentElement).toBe(group?.parentElement);
    expect(group?.previousElementSibling?.id).toBe(STATUS_ID);

    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: re-injecting leaves exactly one button", () => {
    blobDom();
    injectDownloadButton(document, BLOB_TARGET, () => {});
    injectDownloadButton(document, BLOB_TARGET, () => {});
    expect(document.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);
    expect(document.querySelectorAll(`#${STATUS_ID}`).length).toBe(1);
  });

  it("falls back to a floating host when the header has no Raw link", () => {
    expect(injectDownloadButton(document, BLOB_TARGET, () => {})).toBe(true);
    const host = document.getElementById(FLOATING_HOST_ID);
    expect(host).not.toBeNull();
    expect(host?.querySelector(`#${BUTTON_ID}`)).not.toBeNull();
  });

  it("waits on a repo home page until a README is rendered", () => {
    expect(injectDownloadButton(document, HOME_TARGET, () => {})).toBe(false);
    document.body.innerHTML = '<div id="readme"><article class="markdown-body">hi</article></div>';
    expect(injectDownloadButton(document, HOME_TARGET, () => {})).toBe(true);
    expect(document.getElementById(FLOATING_HOST_ID)).not.toBeNull();
  });

  it("keeps the home button floating even when the README links to a raw path", () => {
    // A README may link to `/owner/repo/raw/...` itself; that is page content,
    // not the header's Raw button, and the button must not land inside it.
    document.body.innerHTML =
      '<div id="readme"><article class="markdown-body">' +
      '<a href="/acme/docs/raw/main/logo.png">logo</a></article></div>';
    expect(injectDownloadButton(document, HOME_TARGET, () => {})).toBe(true);

    expect(document.getElementById(FLOATING_HOST_ID)).not.toBeNull();
    const readme = document.getElementById("readme");
    expect(readme?.querySelector(`#${BUTTON_ID}`)).toBeNull();
    expect(readme?.querySelector("a")?.getAttribute("href")).toBe("/acme/docs/raw/main/logo.png");
  });

  it("removeInjected clears the button, status and floating host", () => {
    injectDownloadButton(document, BLOB_TARGET, () => {});
    removeInjected(document);
    expect(document.getElementById(BUTTON_ID)).toBeNull();
    expect(document.getElementById(STATUS_ID)).toBeNull();
    expect(document.getElementById(FLOATING_HOST_ID)).toBeNull();
  });
});

describe("renderButtonState", () => {
  it("shows a disabled Rendering label while busy and restores it after", () => {
    blobDom();
    injectDownloadButton(document, BLOB_TARGET, () => {});
    renderButtonState(document, "busy");
    const button = document.getElementById(BUTTON_ID) as HTMLButtonElement;
    expect(button.textContent).toBe("Rendering PDF…");
    expect(button.disabled).toBe(true);

    renderButtonState(document, "ok", "Saved readme.pdf");
    expect(button.textContent).toBe("Download PDF");
    expect(button.disabled).toBe(false);
    expect(document.getElementById(STATUS_ID)?.textContent).toBe("Saved readme.pdf");
  });

  it("uses the error colour for errors", () => {
    blobDom();
    injectDownloadButton(document, BLOB_TARGET, () => {});
    renderButtonState(document, "error", "Export stopped");
    const status = document.getElementById(STATUS_ID) as HTMLElement;
    expect(status.textContent).toBe("Export stopped");
    expect(status.style.color).toBe("rgb(207, 34, 46)");
  });
});
