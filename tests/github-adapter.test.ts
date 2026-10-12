// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { GitHubMarkdownAdapter } from "../src/adapters/github";
import { AssetError, MarkdownFetchError } from "../src/lib/assets";
import { matchGitHubMarkdown } from "../src/lib/github-url";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Captured {
  url: string;
  init?: RequestInit;
}

/** A fake fetch that records calls and replies with the next queued response. */
function fakeFetch(responses: (Response | Error)[]): { fetchImpl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error(`unexpected fetch: ${url}`);
    return next;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function imageResponse(body: Uint8Array = PNG_BYTES, contentType = "image/png", headers: Record<string, string> = {}) {
  return new Response(body as unknown as BodyInit, { status: 200, headers: { "content-type": contentType, ...headers } });
}

function adapterFor(
  url: string,
  fetchImpl: typeof fetch,
): GitHubMarkdownAdapter {
  const target = matchGitHubMarkdown(url);
  if (!target) throw new Error(`not a markdown url: ${url}`);
  return new GitHubMarkdownAdapter(target, { document: document, fetchImpl });
}

describe("GitHubMarkdownAdapter.resolveAsset", () => {
  it("resolves ./ and bare paths against the file's directory", async () => {
    const { fetchImpl, calls } = fakeFetch([imageResponse()]);
    const adapter = adapterFor("https://github.com/acme/docs/blob/main/guide/setup.md", fetchImpl);
    const uri = await adapter.resolveAsset("./img/diagram.png");
    expect(calls[0]?.url).toBe("https://github.com/acme/docs/raw/main/guide/img/diagram.png");
    expect(uri).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("resolves ../ segments", async () => {
    const { fetchImpl, calls } = fakeFetch([imageResponse()]);
    const adapter = adapterFor("https://github.com/acme/docs/blob/main/guide/setup.md", fetchImpl);
    await adapter.resolveAsset("../images/shot.png");
    expect(calls[0]?.url).toBe("https://github.com/acme/docs/raw/main/images/shot.png");
  });

  it("resolves /-rooted paths against the repository root at the same ref", async () => {
    const { fetchImpl, calls } = fakeFetch([imageResponse()]);
    const adapter = adapterFor("https://github.com/acme/docs/blob/main/guide/setup.md", fetchImpl);
    await adapter.resolveAsset("/assets/logo.png");
    expect(calls[0]?.url).toBe("https://github.com/acme/docs/raw/main/assets/logo.png");
  });

  it("strips query strings and fragments", async () => {
    const { fetchImpl, calls } = fakeFetch([imageResponse()]);
    const adapter = adapterFor("https://github.com/acme/docs/blob/main/readme.md", fetchImpl);
    await adapter.resolveAsset("./shot.png?raw=true#top");
    expect(calls[0]?.url).toBe("https://github.com/acme/docs/raw/main/shot.png");
  });

  it("fetches with the page session (credentials same-origin, redirects followed)", async () => {
    const { fetchImpl, calls } = fakeFetch([imageResponse()]);
    const adapter = adapterFor("https://github.com/acme/docs/blob/main/readme.md", fetchImpl);
    await adapter.resolveAsset("shot.png");
    expect(calls[0]?.init?.credentials).toBe("same-origin");
    expect(calls[0]?.init?.redirect).toBe("follow");
  });

  it("calls fetch with the global receiver, not the adapter (native fetch throws otherwise)", async () => {
    let receiver: unknown = "unset";
    const fetchImpl = function (this: unknown) {
      receiver = this;
      return Promise.resolve(imageResponse());
    } as unknown as typeof fetch;
    const adapter = adapterFor("https://github.com/acme/docs/blob/main/readme.md", fetchImpl);
    await adapter.resolveAsset("shot.png");
    expect(receiver).toBe(globalThis);
  });

  it("rejects a path that escapes the repository", async () => {
    const { fetchImpl } = fakeFetch([]);
    const adapter = adapterFor("https://github.com/acme/docs/blob/main/readme.md", fetchImpl);
    await expect(adapter.resolveAsset("../../../../etc/passwd")).rejects.toThrow(AssetError);
  });

  it("names an HTTP failure", async () => {
    const { fetchImpl } = fakeFetch([new Response("nope", { status: 404 })]);
    const adapter = adapterFor("https://github.com/acme/docs/blob/main/readme.md", fetchImpl);
    await expect(adapter.resolveAsset("missing.png")).rejects.toMatchObject({
      reason: "could not be fetched (HTTP 404)",
    });
  });

  it("names a network failure", async () => {
    const { fetchImpl } = fakeFetch([new TypeError("Failed to fetch")]);
    const adapter = adapterFor("https://github.com/acme/docs/blob/main/readme.md", fetchImpl);
    await expect(adapter.resolveAsset("missing.png")).rejects.toMatchObject({ reason: "could not be fetched" });
  });

  it("refuses an image over the 5 MB cap before reading the body", async () => {
    const { fetchImpl } = fakeFetch([
      imageResponse(PNG_BYTES, "image/png", { "content-length": String(5 * 1024 * 1024 + 1) }),
    ]);
    const adapter = adapterFor("https://github.com/acme/docs/blob/main/readme.md", fetchImpl);
    await expect(adapter.resolveAsset("huge.png")).rejects.toMatchObject({ reason: "too large to embed, max 5MB" });
  });

  it("falls back to the extension's MIME type when GitHub serves an SVG as text/plain", async () => {
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    const { fetchImpl } = fakeFetch([imageResponse(svg, "text/plain; charset=utf-8")]);
    const adapter = adapterFor("https://github.com/acme/docs/blob/main/readme.md", fetchImpl);
    const uri = await adapter.resolveAsset("logo.svg");
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  it("refuses a response that is not an image and has no image extension", async () => {
    const { fetchImpl } = fakeFetch([imageResponse(new TextEncoder().encode("hello"), "text/plain")]);
    const adapter = adapterFor("https://github.com/acme/docs/blob/main/readme.md", fetchImpl);
    await expect(adapter.resolveAsset("notes.txt")).rejects.toMatchObject({ reason: "is not an image" });
  });
});

describe("GitHubMarkdownAdapter.getMarkdown", () => {
  it("fetches the raw URL from the file view", async () => {
    const { fetchImpl, calls } = fakeFetch([
      new Response("# Title\n", { status: 200, headers: { "content-type": "text/plain" } }),
    ]);
    const adapter = adapterFor("https://github.com/acme/docs/blob/main/readme.md", fetchImpl);
    await expect(adapter.getMarkdown()).resolves.toBe("# Title\n");
    expect(calls[0]?.url).toBe("https://github.com/acme/docs/raw/main/readme.md");
  });

  it("tries README.markdown when README.md is missing on the repo home", async () => {
    const { fetchImpl, calls } = fakeFetch([
      new Response("not found", { status: 404 }),
      new Response("# Hi\n", { status: 200 }),
    ]);
    const adapter = adapterFor("https://github.com/acme/docs", fetchImpl);
    await expect(adapter.getMarkdown()).resolves.toBe("# Hi\n");
    expect(calls.map((call) => call.url)).toEqual([
      "https://github.com/acme/docs/raw/HEAD/README.md",
      "https://github.com/acme/docs/raw/HEAD/README.markdown",
    ]);
  });

  it("reports a missing README clearly", async () => {
    const { fetchImpl } = fakeFetch([
      new Response("not found", { status: 404 }),
      new Response("not found", { status: 404 }),
    ]);
    const adapter = adapterFor("https://github.com/acme/docs", fetchImpl);
    const pending = adapter.getMarkdown();
    await expect(pending).rejects.toThrow(MarkdownFetchError);
    await expect(pending).rejects.toThrow("No README.md");
  });

  it("reports a non-404 failure with its status", async () => {
    const { fetchImpl } = fakeFetch([new Response("boom", { status: 500 })]);
    const adapter = adapterFor("https://github.com/acme/docs/blob/main/readme.md", fetchImpl);
    await expect(adapter.getMarkdown()).rejects.toThrow("HTTP 500");
  });
});
