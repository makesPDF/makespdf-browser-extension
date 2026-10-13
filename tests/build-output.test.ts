import { readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAll } from "../scripts/build.mjs";
import { clientHeader } from "../src/lib/build-target";

/**
 * The one-build-two-packages contract: build both targets the way
 * `npm run build` does, then pin what each package actually contains — the
 * per-package `X-MakesPDF-Client` literal and the two MV3 background shapes.
 */

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

let outRoot: string;
let manifests: Record<string, Record<string, unknown>>;
let backgrounds: Record<string, string>;

beforeAll(async () => {
  outRoot = await mkdtemp(join(tmpdir(), "makespdf-build-"));
  await buildAll({ outRoot, targets: ["chromium", "firefox"], zip: false });
  manifests = {
    chromium: JSON.parse(await readFile(join(outRoot, "chromium/manifest.json"), "utf8")),
    firefox: JSON.parse(await readFile(join(outRoot, "firefox/manifest.json"), "utf8")),
  };
  backgrounds = {
    chromium: await readFile(join(outRoot, "chromium/background.js"), "utf8"),
    firefox: await readFile(join(outRoot, "firefox/background.js"), "utf8"),
  };
});

afterAll(async () => {
  if (outRoot) await rm(outRoot, { recursive: true, force: true });
});

describe("built packages", () => {
  it("produces both packages with the full file set", () => {
    for (const target of ["chromium", "firefox"]) {
      for (const file of [
        "manifest.json",
        "content.js",
        "background.js",
        "options/options.html",
        "options/options.js",
        "options/options.css",
      ]) {
        expect(existsSync(join(outRoot, target, file)), `${target}/${file}`).toBe(true);
      }
    }
  });

  it("pins the chromium package's X-MakesPDF-Client literal in its bundle", () => {
    const header = clientHeader(pkg.version, "chromium");
    expect(header).toBe(`browser-extension/${pkg.version}+chromium`);
    expect(backgrounds.chromium).toContain(header);
    expect(backgrounds.chromium).not.toContain(`+firefox`);
  });

  it("pins the firefox package's X-MakesPDF-Client literal in its bundle", () => {
    const header = clientHeader(pkg.version, "firefox");
    expect(header).toBe(`browser-extension/${pkg.version}+firefox`);
    expect(backgrounds.firefox).toContain(header);
    expect(backgrounds.firefox).not.toContain(`+chromium`);
  });

  it("ships a module service worker on chromium and a module event page on firefox", () => {
    expect(manifests.chromium?.background).toEqual({ service_worker: "background.js", type: "module" });
    expect(manifests.firefox?.background).toEqual({ scripts: ["background.js"], type: "module" });
    expect(manifests.firefox?.browser_specific_settings).toMatchObject({
      gecko: { id: "browser-extension@makespdf.com" },
    });
    expect(manifests.chromium?.browser_specific_settings).toBeUndefined();
  });

  it("carries the minimal permission set on both packages", () => {
    for (const target of ["chromium", "firefox"]) {
      const manifest = manifests[target];
      expect(manifest?.manifest_version).toBe(3);
      expect(manifest?.version).toBe(pkg.version);
      expect(manifest?.permissions).toEqual(["storage"]);
      expect(manifest?.host_permissions).toEqual(["https://makespdf.com/*"]);
      expect(JSON.stringify(manifest)).not.toContain("all_urls");
      expect(JSON.stringify(manifest)).not.toContain("downloads");
      expect(manifest?.content_scripts).toEqual([
        { matches: ["https://github.com/*"], js: ["content.js"], run_at: "document_idle" },
      ]);
    }
  });
});
