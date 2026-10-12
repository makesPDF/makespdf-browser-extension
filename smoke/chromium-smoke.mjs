/**
 * Chromium smoke for the built extension — the scripted half of the manual
 * smoke the PR records. Not part of CI (it needs a real browser and the
 * production service).
 *
 *   npm run build
 *   node smoke/chromium-smoke.mjs
 *
 * It loads dist/chromium into a persistent Chromium context, opens the public
 * fixture on GitHub (smoke/fixture.md), clicks the injected button and checks
 * the downloaded PDF; then soft-navigates to smoke/second.md and checks the
 * button stays singular and still works; then checks the repo-home button.
 *
 * Playwright is not a dependency of this repo. The script resolves it from
 * `node_modules`, then from a sibling makesPDF checkout (which has it), and
 * finally from `PLAYWRIGHT_HOME` if set.
 */

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "https://github.com/makesPDF/makespdf-browser-extension";
const EXTENSION = process.env.EXTENSION_DIR ?? join(ROOT, "dist/chromium");
const OUT = process.env.SMOKE_OUT ?? join(tmpdir(), `makespdf-smoke-${process.pid}`);

function loadPlaywright() {
  const anchors = [join(ROOT, "package.json"), process.env.PLAYWRIGHT_HOME, "/Users/jason/dev/pdf/makesPDF/package.json"].filter(
    Boolean,
  );
  for (const anchor of anchors) {
    const require = createRequire(anchor);
    for (const moduleName of ["playwright", "@playwright/test"]) {
      try {
        return require(moduleName);
      } catch {
        // try the next module/anchor
      }
    }
  }
  throw new Error("playwright not found; set PLAYWRIGHT_HOME to a project that has it installed");
}

const { chromium } = loadPlaywright();
mkdirSync(OUT, { recursive: true });

const context = await chromium.launchPersistentContext(join(OUT, "profile"), {
  channel: "chromium",
  headless: true,
  acceptDownloads: true,
  args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
});

const page = await context.newPage();
const pageErrors = [];
const consoleMessages = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
page.on("console", (message) => consoleMessages.push(`page ${message.type()}: ${message.text()}`));
context.on("serviceworker", (worker) => {
  worker.on("console", (message) => consoleMessages.push(`sw ${message.type()}: ${message.text()}`));
});

let failed = false;
const step = (message) => console.log(`→ ${message}`);
const ok = (message) => console.log(`   ✓ ${message}`);

try {
  step("blob view of smoke/fixture.md");
  await page.goto(`${REPO}/blob/main/smoke/fixture.md`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#makespdf-download-pdf-button", { timeout: 45_000 });
  assert.equal(await page.locator("#makespdf-download-pdf-button").count(), 1, "exactly one button");
  ok("button injected");

  step("click Download PDF");
  const firstDownload = page.waitForEvent("download", { timeout: 180_000 });
  await page.click("#makespdf-download-pdf-button");
  await page.waitForFunction(
    () => {
      const status = document.getElementById("makespdf-download-pdf-status");
      return Boolean(status && status.textContent && status.textContent !== "Rendering PDF…");
    },
    { timeout: 170_000 },
  );
  console.log(`   status: ${await page.textContent("#makespdf-download-pdf-status")}`);
  const download = await firstDownload;
  assert.equal(download.suggestedFilename(), "fixture.pdf", "suggested filename");
  await download.saveAs(join(OUT, "fixture.pdf"));
  const bytes = readFileSync(join(OUT, "fixture.pdf"));
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-", "PDF magic bytes");
  assert.ok(bytes.length > 5_000, `PDF is ${bytes.length} bytes`);
  const status = await page.textContent("#makespdf-download-pdf-status");
  assert.match(status ?? "", /^Saved fixture\.pdf/, `status: ${status}`);
  ok(`${bytes.length} bytes, status "${status}"`);

  step("soft-navigate to smoke/second.md");
  await page.click('a[href$="second.md"]');
  await page.waitForURL(/second\.md/, { timeout: 30_000 });
  await page.waitForSelector("#makespdf-download-pdf-button", { timeout: 30_000 });
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  assert.equal(await page.locator("#makespdf-download-pdf-button").count(), 1, "still exactly one button");
  ok("no duplicate button after soft navigation");

  const secondDownload = page.waitForEvent("download", { timeout: 180_000 });
  await page.click("#makespdf-download-pdf-button");
  const second = await secondDownload;
  assert.equal(second.suggestedFilename(), "second.pdf", "second suggested filename");
  await second.saveAs(join(OUT, "second.pdf"));
  const secondBytes = readFileSync(join(OUT, "second.pdf"));
  assert.equal(secondBytes.subarray(0, 5).toString(), "%PDF-");
  ok(`${secondBytes.length} bytes as second.pdf`);

  step("repo home README");
  await page.goto(REPO, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#makespdf-download-pdf-host #makespdf-download-pdf-button", { timeout: 45_000 });
  ok("home button present");
} catch (error) {
  failed = true;
  console.error(`\nSMOKE FAILED: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (pageErrors.length > 0) {
    failed = true;
    console.error("page errors:", pageErrors);
  }
  if (consoleMessages.length > 0) {
    console.log("console output:", consoleMessages);
  }
  await context.close();
}

if (failed) process.exit(1);
console.log(`\nSMOKE PASSED (artifacts in ${OUT})`);
