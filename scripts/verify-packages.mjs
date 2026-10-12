/**
 * Structural verification of a built dist/ tree:   node scripts/verify-packages.mjs
 *
 * This is the "loadable package" gate for CI. It cannot open a browser, so it
 * checks the next best thing: every file the manifests reference exists, the
 * two manifests differ the way each browser's MV3 requires, and the built
 * background bundle carries that package's `X-MakesPDF-Client` value.
 */

import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TARGETS, manifestFor } from "./manifest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const failures = [];
function check(condition, message) {
  if (condition) console.log(`  ok  ${message}`);
  else {
    failures.push(message);
    console.error(` FAIL ${message}`);
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
const outRoot = join(ROOT, "dist");

for (const target of TARGETS) {
  const dir = join(outRoot, target);
  console.log(`\n${target}:`);
  check(await exists(dir), `${target} package directory exists`);

  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  const expected = manifestFor(target, pkg.version);
  check(manifest.manifest_version === 3, "manifest is MV3");
  check(manifest.version === pkg.version, `manifest version is ${pkg.version}`);
  check(
    JSON.stringify(manifest.background) === JSON.stringify(expected.background),
    `background matches target (${JSON.stringify(expected.background)})`,
  );
  check(
    manifest.content_scripts?.[0]?.matches?.includes("https://github.com/*"),
    "content script matches github.com",
  );
  check(manifest.permissions?.includes("storage"), "storage permission present");
  check(
    manifest.host_permissions?.includes("https://makespdf.com/*"),
    "makespdf.com host permission present",
  );
  check(!JSON.stringify(manifest).includes("all_urls"), "no <all_urls>");

  if (target === "firefox") {
    check(manifest.browser_specific_settings?.gecko?.id, "firefox has a Gecko id");
  } else {
    check(!manifest.browser_specific_settings, "chromium has no browser_specific_settings");
  }

  for (const file of ["content.js", "background.js", "options/options.html", "options/options.js", "options/options.css"]) {
    check(await exists(join(dir, file)), `${file} exists`);
  }

  const background = await readFile(join(dir, "background.js"), "utf8");
  const header = `browser-extension/${pkg.version}+${target}`;
  check(background.includes(header), `background bundle carries "${header}"`);

  const content = await readFile(join(dir, "content.js"), "utf8");
  check(!content.includes("__BUILD_TARGET__"), "content bundle has no unresolved __BUILD_TARGET__");
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nAll package checks passed.");
