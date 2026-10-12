import { describe, expect, it } from "vitest";
import { mapFetchError, mapHttpError } from "../src/lib/errors";
import { SIGNUP_URL } from "../src/lib/service";

describe("mapHttpError", () => {
  it("401 with a saved key blames the key", () => {
    const mapped = mapHttpError(401, JSON.stringify({ error: "Authentication required." }), { hasKey: true });
    expect(mapped.kind).toBe("auth");
    expect(mapped.message).toBe("Authentication failed. Check the API key in the makesPDF extension options.");
  });

  it("401 anonymously points at sign-up", () => {
    const mapped = mapHttpError(401, "", { hasKey: false });
    expect(mapped.kind).toBe("auth");
    expect(mapped.message).toContain(SIGNUP_URL);
  });

  it("403 behaves like 401", () => {
    expect(mapHttpError(403, "", { hasKey: true }).kind).toBe("auth");
  });

  it("429 anonymous carries the server's tip, which names sign-up", () => {
    const tip = "Anonymous renders are capped. Higher limits: https://makespdf.com/signup";
    const mapped = mapHttpError(429, JSON.stringify({ error: "rate-limited", tip }), { hasKey: false });
    expect(mapped.kind).toBe("rate-limit");
    expect(mapped.message).toBe(`Rate limited. ${tip}`);
  });

  it("429 anonymous without a tip still hints at sign-up", () => {
    const mapped = mapHttpError(429, "", { hasKey: false });
    expect(mapped.kind).toBe("rate-limit");
    expect(mapped.message).toContain("sign up");
    expect(mapped.message).toContain(SIGNUP_URL);
  });

  it("429 with a key does not push sign-up", () => {
    const mapped = mapHttpError(429, "", { hasKey: true });
    expect(mapped.message).toBe("Rate limited. Wait a few minutes and try again.");
  });

  it("400 page-cap-exceeded spells out the cap", () => {
    const mapped = mapHttpError(
      400,
      JSON.stringify({ error: "page-cap-exceeded", limit: 20, actual: 34 }),
      { hasKey: false },
    );
    expect(mapped.kind).toBe("bad-request");
    expect(mapped.message).toContain("34 pages");
    expect(mapped.message).toContain("cap 20");
  });

  it("400 otherwise surfaces the server's error code", () => {
    const mapped = mapHttpError(400, JSON.stringify({ error: "Invalid request" }), { hasKey: true });
    expect(mapped.kind).toBe("bad-request");
    expect(mapped.message).toContain("Invalid request");
  });

  it("413 surfaces the server's own wording", () => {
    const mapped = mapHttpError(413, JSON.stringify({ error: "Payload too large" }), { hasKey: false });
    expect(mapped.kind).toBe("payload-too-large");
    expect(mapped.message).toContain("Payload too large");
  });

  it("5xx is a server error", () => {
    const mapped = mapHttpError(500, JSON.stringify({ error: "boom" }), { hasKey: false });
    expect(mapped.kind).toBe("server");
    expect(mapped.message).toContain("HTTP 500");
  });

  it("survives a non-JSON body", () => {
    const mapped = mapHttpError(400, "<html>nope</html>", { hasKey: false });
    expect(mapped.kind).toBe("bad-request");
    expect(mapped.message).toContain("Bad request");
  });
});

describe("mapFetchError", () => {
  it("maps an abort/timeout to a timed-out message", () => {
    const error = new Error("timed out");
    error.name = "TimeoutError";
    expect(mapFetchError(error).message).toContain("did not respond in time");
  });

  it("maps anything else to a connectivity message", () => {
    expect(mapFetchError(new TypeError("Failed to fetch")).kind).toBe("network");
    expect(mapFetchError(new TypeError("Failed to fetch")).message).toContain("Could not reach makesPDF");
  });
});
