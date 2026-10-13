import { describe, expect, it } from "vitest";
import { CLIENT_HEADER, clientHeader } from "../src/lib/build-target";

/**
 * The header value each package must send (operator decision 2026-10-09).
 * The build-output test additionally requires this exact string in each
 * package's built background bundle.
 */
describe("clientHeader", () => {
  it("pins the chromium package's value", () => {
    expect(clientHeader("1.0.0", "chromium")).toBe("browser-extension/1.0.0+chromium");
  });

  it("pins the firefox package's value", () => {
    expect(clientHeader("1.0.0", "firefox")).toBe("browser-extension/1.0.0+firefox");
  });

  it("keeps the version's own dots and the '+' build separator", () => {
    expect(clientHeader("0.1.0-beta.2", "chromium")).toBe("browser-extension/0.1.0-beta.2+chromium");
  });

  it("falls back to the chromium label outside a build (tests/dev)", () => {
    expect(CLIENT_HEADER).toBe("browser-extension/0.0.0+chromium");
  });
});
