import { describe, expect, it } from "vitest";
import { clientHeader } from "../src/lib/build-target";
import { RENDER_MESSAGE_TYPE, type RenderRequest } from "../src/lib/messages";
import { renderMarkdown } from "../src/lib/render-client";
import { MD_ENDPOINT } from "../src/lib/service";

const REQUEST: RenderRequest = {
  type: RENDER_MESSAGE_TYPE,
  markdown: "# Title\n\n![shot](./img/shot.png)",
  title: "README",
  filename: "README.pdf",
};

interface Captured {
  url: string;
  init?: RequestInit;
}

function captureFetch(...responses: (Response | Error)[]) {
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

function pdfResponse() {
  return new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { "content-type": "application/pdf", "X-Pages": "2", "X-Render-Ms": "180" },
  });
}

describe("renderMarkdown", () => {
  it("POSTs the markdown and options to /api/v1/md with the anonymous client header (chromium build)", async () => {
    const { fetchImpl, calls } = captureFetch(pdfResponse());
    const result = await renderMarkdown(REQUEST, {
      fetchImpl,
      clientHeaderValue: clientHeader("0.1.0", "chromium"),
      getApiKey: async () => null,
      getStoredDefaults: async () => ({ pageSize: "A4", theme: "github" }),
    });

    expect(calls[0]?.url).toBe(MD_ENDPOINT);
    expect(calls[0]?.init?.method).toBe("POST");
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers["X-MakesPDF-Client"]).toBe("browser-extension/0.1.0+chromium");
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      markdown: REQUEST.markdown,
      options: { title: "README", pageSize: "A4", theme: "github" },
    });

    expect(result).toEqual({
      ok: true,
      base64: "AQID",
      filename: "README.pdf",
      pages: "2",
      renderMs: "180",
    });
  });

  it("pins the firefox build's header", async () => {
    const { fetchImpl, calls } = captureFetch(pdfResponse());
    await renderMarkdown(REQUEST, {
      fetchImpl,
      clientHeaderValue: clientHeader("0.1.0", "firefox"),
      getApiKey: async () => null,
    });
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers["X-MakesPDF-Client"]).toBe("browser-extension/0.1.0+firefox");
  });

  it("sends a saved API key as a Bearer token, and omits page defaults when none are stored", async () => {
    const { fetchImpl, calls } = captureFetch(pdfResponse());
    await renderMarkdown(REQUEST, {
      fetchImpl,
      clientHeaderValue: clientHeader("0.1.0", "chromium"),
      getApiKey: async () => "secret-key",
    });
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-key");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      markdown: REQUEST.markdown,
      options: { title: "README" },
    });
  });

  it("maps a 401 with a saved key to the key message", async () => {
    const { fetchImpl } = captureFetch(
      new Response(JSON.stringify({ error: "Authentication required." }), { status: 401 }),
    );
    const result = await renderMarkdown(REQUEST, {
      fetchImpl,
      clientHeaderValue: clientHeader("0.1.0", "chromium"),
      getApiKey: async () => "stale",
    });
    expect(result).toEqual({
      ok: false,
      kind: "auth",
      message: "Authentication failed. Check the API key in the makesPDF extension options.",
    });
  });

  it("maps an anonymous 429 to a rate-limit message with the sign-up hint", async () => {
    const { fetchImpl } = captureFetch(new Response("", { status: 429 }));
    const result = await renderMarkdown(REQUEST, {
      fetchImpl,
      clientHeaderValue: clientHeader("0.1.0", "chromium"),
      getApiKey: async () => null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("rate-limit");
      expect(result.message).toContain("sign up");
    }
  });

  it("maps a 413 to the payload message", async () => {
    const { fetchImpl } = captureFetch(new Response(JSON.stringify({ error: "Payload too large" }), { status: 413 }));
    const result = await renderMarkdown(REQUEST, {
      fetchImpl,
      clientHeaderValue: clientHeader("0.1.0", "chromium"),
      getApiKey: async () => null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("payload-too-large");
  });

  it("maps a thrown fetch to a network message", async () => {
    const { fetchImpl } = captureFetch(new TypeError("Failed to fetch"));
    const result = await renderMarkdown(REQUEST, {
      fetchImpl,
      clientHeaderValue: clientHeader("0.1.0", "chromium"),
      getApiKey: async () => null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("network");
  });

  it("calls fetch with the global receiver, not the deps object (native fetch throws otherwise)", async () => {
    let receiver: unknown = "unset";
    const fetchImpl = function (this: unknown) {
      receiver = this;
      return Promise.resolve(pdfResponse());
    } as unknown as typeof fetch;
    await renderMarkdown(REQUEST, {
      fetchImpl,
      clientHeaderValue: clientHeader("0.1.0", "chromium"),
      getApiKey: async () => null,
    });
    expect(receiver).toBe(globalThis);
  });

  it("sanitizes the returned filename", async () => {
    const { fetchImpl } = captureFetch(pdfResponse());
    const result = await renderMarkdown(
      { ...REQUEST, filename: 'weird/name:".pdf' },
      { fetchImpl, clientHeaderValue: clientHeader("0.1.0", "chromium"), getApiKey: async () => null },
    );
    expect(result.ok && result.filename).toBe("weird-name--.pdf");
  });
});
