// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUTTON_ID, FLOATING_HOST_ID, STATUS_ID } from "../src/lib/button";
import { startController, type ControllerOptions } from "../src/lib/controller";
import { RENDER_MESSAGE_TYPE, type RenderRequest, type RenderResponse } from "../src/lib/messages";

const BLOB_A = "https://github.com/acme/docs/blob/main/readme.md";
const BLOB_B = "https://github.com/acme/docs/blob/main/guide/setup.md";
const RAW_A = "https://github.com/acme/docs/raw/main/readme.md";
const RAW_B = "https://github.com/acme/docs/raw/main/guide/setup.md";
const IMG_A = "https://github.com/acme/docs/raw/main/img/shot.png";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function blobDom(): void {
  document.body.innerHTML = `
    <div class="react-blob-header-edit-and-raw-actions">
      <div data-component="ButtonGroup">
        <a data-testid="raw-button" href="/acme/docs/raw/refs/heads/main/readme.md">Raw</a>
      </div>
    </div>`;
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function imageResponse(): Response {
  return new Response(PNG_BYTES, { status: 200, headers: { "content-type": "image/png" } });
}

type Route = () => Response | Error;

function routerFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch: ${url}`);
    const result = route();
    if (result instanceof Error) throw result;
    return result;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

interface Harness {
  location: Location;
  cleanup: () => void;
  requests: RenderRequest[];
  button: () => HTMLElement | null;
  click: () => void;
}

function start(options: {
  href: string;
  routes: Record<string, Route>;
  respond?: (request: RenderRequest) => RenderResponse;
}): Harness {
  const location = { href: options.href } as Location;
  const { fetchImpl, calls } = routerFetch(options.routes);
  const requests: RenderRequest[] = [];
  const controllerOptions: ControllerOptions = {
    document,
    location,
    fetchImpl,
    sendMessage: async (request) => {
      requests.push(request);
      if (calls.length === 0) throw new Error("sendMessage called before any fetch");
      return (
        options.respond?.(request) ?? {
          ok: true,
          base64: "AQID",
          filename: request.filename,
          pages: null,
          renderMs: null,
        }
      );
    },
  };
  const cleanup = startController(controllerOptions);
  return {
    location,
    cleanup,
    requests,
    button: () => document.getElementById(BUTTON_ID),
    click: () => {
      document.getElementById(BUTTON_ID)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    },
  };
}

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let anchorClick: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  createObjectURL = vi.fn(() => "blob:fake-url");
  revokeObjectURL = vi.fn();
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL;
  anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startController", () => {
  it("injects a button on a markdown blob page and not elsewhere", () => {
    blobDom();
    const harness = start({ href: BLOB_A, routes: { [RAW_A]: () => textResponse("# A") } });
    expect(harness.button()).not.toBeNull();
    harness.cleanup();

    document.body.innerHTML = "";
    const other = start({ href: "https://github.com/acme/docs/blob/main/index.ts", routes: {} });
    expect(other.button()).toBeNull();
    other.cleanup();
  });

  it("keeps exactly one button across a soft navigation and rebinds it to the new file", async () => {
    blobDom();
    const harness = start({
      href: BLOB_A,
      routes: { [RAW_A]: () => textResponse("# A"), [RAW_B]: () => textResponse("# B") },
    });
    expect(harness.button()).not.toBeNull();

    harness.location.href = BLOB_B;
    document.dispatchEvent(new Event("turbo:load"));
    await vi.advanceTimersByTimeAsync(200);

    expect(document.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);
    expect(document.querySelectorAll(`#${STATUS_ID}`).length).toBe(1);

    // The re-injected button must export the NEW file.
    harness.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.requests[0]?.markdown).toBe("# B");

    harness.cleanup();
  });

  it("re-injects after GitHub replaces the DOM without changing the URL", async () => {
    blobDom();
    const harness = start({ href: BLOB_A, routes: { [RAW_A]: () => textResponse("# A") } });
    document.getElementById(BUTTON_ID)?.remove();
    document.getElementById(STATUS_ID)?.remove();
    blobDom();
    document.dispatchEvent(new Event("turbo:render"));
    await vi.advanceTimersByTimeAsync(200);
    expect(document.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);
    harness.cleanup();
  });

  it("inlines relative images and saves the PDF", async () => {
    blobDom();
    const harness = start({
      href: BLOB_A,
      routes: {
        [RAW_A]: () => textResponse('![shot](./img/shot.png)\n\n# A'),
        [IMG_A]: () => imageResponse(),
      },
    });
    harness.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0]).toEqual({
      type: RENDER_MESSAGE_TYPE,
      markdown: '![shot](data:image/png;base64,iVBORw==)\n\n# A',
      title: "readme",
      filename: "readme.pdf",
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(document.getElementById(STATUS_ID)?.textContent).toBe("Saved readme.pdf");
    harness.cleanup();
  });

  it("stops before the request and names the image when an image fetch fails", async () => {
    blobDom();
    const harness = start({
      href: BLOB_A,
      routes: {
        [RAW_A]: () => textResponse("![shot](./img/shot.png)"),
        [IMG_A]: () => new Response("not found", { status: 404 }),
      },
    });
    harness.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.requests).toHaveLength(0);
    expect(createObjectURL).not.toHaveBeenCalled();
    const status = document.getElementById(STATUS_ID)?.textContent ?? "";
    expect(status).toContain("./img/shot.png");
    expect(status).toContain("could not be fetched (HTTP 404)");
    harness.cleanup();
  });

  it("shows the background's failure message", async () => {
    blobDom();
    const harness = start({
      href: BLOB_A,
      routes: { [RAW_A]: () => textResponse("# A") },
      respond: () => ({ ok: false, kind: "auth", message: "Authentication failed. Check the API key." }),
    });
    harness.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(document.getElementById(STATUS_ID)?.textContent).toBe("Authentication failed. Check the API key.");
    expect(createObjectURL).not.toHaveBeenCalled();
    harness.cleanup();
  });

  it("waits for the README before injecting on a repo home page", async () => {
    const harness = start({
      href: "https://github.com/acme/docs",
      routes: { "https://github.com/acme/docs/raw/HEAD/README.md": () => textResponse("# Home") },
    });
    expect(harness.button()).toBeNull();

    document.body.innerHTML = '<div id="readme"><div class="markdown-body">hi</div></div>';
    await vi.advanceTimersByTimeAsync(200);
    expect(document.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);
    expect(document.getElementById(FLOATING_HOST_ID)).not.toBeNull();
    harness.cleanup();
  });

  it("removes the button when navigating away from a markdown view", async () => {
    blobDom();
    const harness = start({ href: BLOB_A, routes: {} });
    expect(harness.button()).not.toBeNull();

    harness.location.href = "https://github.com/acme/docs/blob/main/index.ts";
    document.dispatchEvent(new Event("turbo:load"));
    await vi.advanceTimersByTimeAsync(200);
    expect(harness.button()).toBeNull();
    harness.cleanup();
  });
});
