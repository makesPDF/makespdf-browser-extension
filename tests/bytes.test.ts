import { describe, expect, it } from "vitest";
import { base64FromBytes, bytesFromBase64 } from "../src/lib/bytes";

describe("base64 helpers", () => {
  it("round-trips small payloads", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect(bytesFromBase64(base64FromBytes(bytes))).toEqual(bytes);
  });

  it("round-trips payloads larger than one encode chunk", () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const encoded = base64FromBytes(bytes);
    expect(encoded.length).toBeGreaterThan(0x10000);
    expect(bytesFromBase64(encoded)).toEqual(bytes);
  });

  it("round-trips an empty payload", () => {
    expect(base64FromBytes(new Uint8Array(0))).toBe("");
    expect(bytesFromBase64("")).toEqual(new Uint8Array(0));
  });
});
