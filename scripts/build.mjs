/**
 * One build, two loadable packages:   node scripts/build.mjs
 *
 * Produces dist/chromium and dist/firefox, each a complete unpacked
 * extension (Chrome: chrome://extensions → Load unpacked; Firefox:
 * about:debugging → Load Temporary Add-on), plus a zip of each.
 *
 * The only source-level difference between the packages is the
 * `__BUILD_TARGET__` define, which drives the `X-MakesPDF-Client` header
 * (`browser-extension/<version>+<build>`) and the manifest's background key.
 */

import { build } from "esbuild";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import JSZip from "jszip";
import { TARGETS, manifestFor } from "./manifest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Recursively add a directory's files to a JSZip archive. */
async function addDir(zip, dir, prefix) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await addDir(zip, full, rel);
    else zip.file(rel, await readFile(full));
  }
}

/**
 * Build every target into `outRoot` (default `<repo>/dist`).
 *
 * Exported so the unit tests can build into a temp directory and pin the
 * built artifacts (the client header per package, manifest keys) without
 * touching the working tree's dist/.
 *
 * @returns {Promise<string[]>} paths written (per target: dir, and zip when requested)
 */
export async function buildAll({ outRoot = join(ROOT, "dist"), targets = TARGETS, zip = false } = {}) {
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  await rm(outRoot, { recursive: true, force: true });
  const written = [];

  for (const target of targets) {
    const outDir = join(outRoot, target);
    await mkdir(join(outDir, "options"), { recursive: true });

    const common = {
      bundle: true,
      platform: "browser",
      // Both baselines support ES2022 in extension contexts.
      target: ["chrome109", "firefox115"],
      define: {
        __BUILD_TARGET__: JSON.stringify(target),
        __EXTENSION_VERSION__: JSON.stringify(pkg.version),
      },
      logLevel: "warning",
      legalComments: "none",
      minify: false,
      sourcemap: false,
    };

    // Content scripts are classic scripts (no ES modules in MV3 content
    // scripts) — bundle to a single IIFE.
    await build({
      ...common,
      entryPoints: [join(ROOT, "src/content.ts")],
      outfile: join(outDir, "content.js"),
      format: "iife",
    });

    // Background runs as a module in both packages (service worker on
    // Chrome, event page on Firefox).
    await build({
      ...common,
      entryPoints: [join(ROOT, "src/background.ts")],
      outfile: join(outDir, "background.js"),
      format: "esm",
    });

    // Options page: a classic script loaded by options.html.
    await build({
      ...common,
      entryPoints: [join(ROOT, "src/options/options.ts")],
      outfile: join(outDir, "options/options.js"),
      format: "iife",
    });

    await copyFile(join(ROOT, "src/options/options.html"), join(outDir, "options/options.html"));
    await copyFile(join(ROOT, "src/options/options.css"), join(outDir, "options/options.css"));
    await writeFile(
      join(outDir, "manifest.json"),
      `${JSON.stringify(manifestFor(target, pkg.version), null, 2)}\n`,
    );
    written.push(outDir);

    if (zip) {
      const archive = new JSZip();
      await addDir(archive, outDir, "");
      const zipPath = join(outRoot, `makespdf-${target}-${pkg.version}.zip`);
      await writeFile(zipPath, await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
      written.push(zipPath);
    }
  }

  return written;
}

// Run only when invoked directly, so tests can import buildAll.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const written = await buildAll({ zip: true });
  for (const path of written) console.log(`built ${path}`);
}
