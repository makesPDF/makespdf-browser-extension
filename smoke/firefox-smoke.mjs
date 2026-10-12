/**
 * Firefox smoke for the built extension — the scripted half of the manual
 * smoke the PR records. Not part of CI (it needs a real browser, web-ext and
 * the production service).
 *
 *   npm run build
 *   node smoke/firefox-smoke.mjs
 *
 * Playwright cannot load extensions in its Firefox, so this drives the real
 * Firefox instead: `web-ext run` installs dist/firefox as a temporary add-on
 * (unsigned, no store), and a small Marionette client (enabled through the
 * profile's user.js) checks the same flow the Chromium smoke checks — the
 * injected button, a real anonymous render downloaded as fixture.pdf, a soft
 * navigation that leaves exactly one button, and the repo-home button.
 *
 * Environment:
 *   FIREFOX_BIN    Firefox binary (default /Applications/Firefox.app/...)
 *   EXTENSION_DIR  built package to load (default dist/firefox)
 *   SMOKE_REF      ref of the fixtures (default main; point at the task
 *                  branch while the fixtures are unmerged)
 *   SMOKE_OUT      artifact directory (default a fresh temp dir)
 *
 * web-ext is resolved with `npx --yes web-ext` (it is not a repo dependency,
 * like Playwright for the Chromium smoke).
 */

import { spawn } from "node:child_process";
import net from "node:net";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION = process.env.EXTENSION_DIR ?? join(ROOT, "dist/firefox");
const FIREFOX_BIN = process.env.FIREFOX_BIN ?? "/Applications/Firefox.app/Contents/MacOS/firefox";
const REF = process.env.SMOKE_REF ?? "main";
const OUT = process.env.SMOKE_OUT ?? mkdtempSync(join(tmpdir(), "makespdf-ff-smoke-"));
const PROFILE = join(OUT, "profile");
const DOWNLOADS = join(OUT, "downloads");
const LOG = join(OUT, "web-ext.log");
const PORT = 2828;
const REPO = "https://github.com/makesPDF/makespdf-browser-extension";
const README_REPO = "https://github.com/makesPDF/makespdf-vscode-plugin";

mkdirSync(PROFILE, { recursive: true });
mkdirSync(DOWNLOADS, { recursive: true });
writeFileSync(
  join(PROFILE, "user.js"),
  [
    'user_pref("marionette.enabled", true);',
    `user_pref("marionette.port", ${PORT});`,
    'user_pref("browser.download.folderList", 2);',
    `user_pref("browser.download.dir", "${DOWNLOADS}");`,
    'user_pref("browser.download.useDownloadDir", true);',
    'user_pref("browser.download.alwaysOpenPanel", false);',
    'user_pref("browser.download.start_downloads_in_tmp_dir", false);',
    'user_pref("browser.helperApps.neverAsk.saveToDisk", "application/pdf,image/png,text/plain,application/octet-stream");',
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    "",
  ].join("\n"),
);

const logFd = openSync(LOG, "w");
const child = spawn(
  "npx",
  [
    "--yes", "web-ext", "run",
    "--source-dir", EXTENSION,
    "--firefox", FIREFOX_BIN,
    "--firefox-profile", PROFILE,
    "--keep-profile-changes",
    "--args=--headless",
    "--args=--marionette",
    "--no-reload",
    "--no-input",
    "--verbose",
  ],
  { detached: true, stdio: ["ignore", logFd, logFd] },
);

let childExited = false;
let childCode = null;
child.on("exit", (code) => {
  childExited = true;
  childCode = code;
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForPort(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (childExited) throw new Error(`web-ext exited early (code ${childCode})`);
    const open = await new Promise((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port: PORT }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
    });
    if (open) return;
    await sleep(500);
  }
  throw new Error("timed out waiting for the Marionette port");
}

/** Minimal Marionette client:  length-prefixed JSON, commands [0, id, name, params]. */
class Marionette {
  constructor() {
    this.buf = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.connect({ host: "127.0.0.1", port: PORT });
      this.socket.on("connect", resolve);
      this.socket.on("error", reject);
      this.socket.on("data", (chunk) => this.onData(chunk));
    });
  }

  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const colon = this.buf.indexOf(0x3a);
      if (colon < 0) return;
      const length = Number.parseInt(this.buf.subarray(0, colon).toString("utf8"), 10);
      if (!Number.isFinite(length)) throw new Error("bad Marionette frame");
      const start = colon + 1;
      if (this.buf.length < start + length) return;
      const payload = JSON.parse(this.buf.subarray(start, start + length).toString("utf8"));
      this.buf = this.buf.subarray(start + length);
      if (Array.isArray(payload) && payload[0] === 1) {
        const [, id, error, result] = payload;
        const entry = this.pending.get(id);
        if (!entry) continue;
        this.pending.delete(id);
        if (error) entry.reject(new Error(`${error.error}: ${error.message}`));
        else entry.resolve(result);
      }
    }
  }

  send(command, params = {}) {
    const id = this.nextId++;
    const bytes = Buffer.from(JSON.stringify([0, id, command, params]), "utf8");
    this.socket.write(`${bytes.length}:`);
    this.socket.write(bytes);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }
}

let failed = false;
const step = (message) => console.log(`→ ${message}`);
const ok = (message) => console.log(`   ✓ ${message}`);

try {
  step(`loading ${EXTENSION} into Firefox (${FIREFOX_BIN})`);
  await waitForPort(120_000);
  await sleep(2_000);

  const marionette = new Marionette();
  await marionette.connect();
  await sleep(500);
  await marionette.send("WebDriver:NewSession", { capabilities: { alwaysMatch: {} } });

  // ExecuteScript results are WebDriver primitives ({value: …}); the script
  // body must `return` explicitly.
  const script = async (source) => {
    const result = await marionette.send("WebDriver:ExecuteScript", { script: source, args: [] });
    return result !== null && typeof result === "object" && "value" in result ? result.value : result;
  };
  const navigate = (url) => marionette.send("WebDriver:Navigate", { url });

  const pollScript = async (source, label, timeoutMs = 45_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let value;
      try {
        value = await script(source);
      } catch (error) {
        value = `error: ${error.message}`;
      }
      if (value !== null && value !== false && value !== 0 && value !== "" && !String(value).startsWith("error:")) {
        return value;
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label} (last: ${String(value)})`);
      await sleep(1_000);
    }
  };

  const statusText = `((document.getElementById('makespdf-download-pdf-status') || {}).textContent || '')`;
  const buttonCount = `return document.querySelectorAll('#makespdf-download-pdf-button').length;`;

  step(`blob view of smoke/fixture.md at ${REF}`);
  await navigate(`${REPO}/blob/${REF}/smoke/fixture.md`);
  await pollScript(buttonCount, "button injected");
  assert.equal(await script(buttonCount), 1, "exactly one button");
  ok("button injected");

  step("click Download PDF");
  await script(`document.getElementById('makespdf-download-pdf-button').click(); return true;`);
  // Watch button/status transitions so a failure names the phase it stopped in.
  const probe = `return JSON.stringify({
    button: ((document.getElementById('makespdf-download-pdf-button') || {}).textContent || null),
    status: ((document.getElementById('makespdf-download-pdf-status') || {}).textContent || null)
  });`;
  let lastState = "";
  let saved = "";
  const probeDeadline = Date.now() + 150_000;
  for (;;) {
    const state = await script(probe);
    if (state !== lastState) {
      console.log(`   state: ${state}`);
      lastState = state;
    }
    const parsed = JSON.parse(state);
    if ((parsed.status || "").startsWith("Saved")) {
      saved = parsed.status;
      break;
    }
    if ((parsed.status || "").length > 0) throw new Error(`export reported an error: ${parsed.status}`);
    if (Date.now() > probeDeadline) throw new Error(`no render result after 150s; last state: ${state}`);
    await sleep(2_000);
  }
  ok(`status: ${saved}`);

  const firstPath = join(DOWNLOADS, "fixture.pdf");
  const deadline = Date.now() + 30_000;
  while (!existsSync(firstPath)) {
    if (Date.now() > deadline) throw new Error(`fixture.pdf not in ${DOWNLOADS}`);
    await sleep(500);
  }
  const bytes = readFileSync(firstPath);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-", "PDF magic bytes");
  assert.ok(bytes.length > 5_000, `PDF is ${bytes.length} bytes`);
  ok(`fixture.pdf ${bytes.length} bytes`);

  step("soft-navigate to smoke/second.md");
  await script(`document.querySelector('a[href$="second.md"]').click(); return true;`);
  await pollScript(`return location.pathname.endsWith('second.md') ? 'yes' : '';`, "URL changed");
  await sleep(1_000);
  assert.equal(await script(buttonCount), 1, "still exactly one button");
  ok("no duplicate button after soft navigation");

  await script(`document.getElementById('makespdf-download-pdf-button').click(); return true;`);
  const secondSaved = await pollScript(
    `return (() => { const t = ${statusText}; return t.startsWith('Saved second') ? t : ''; })();`,
    "second download status",
    180_000,
  );
  ok(`status: ${secondSaved}`);
  const secondPath = join(DOWNLOADS, "second.pdf");
  const secondDeadline = Date.now() + 30_000;
  while (!existsSync(secondPath)) {
    if (Date.now() > secondDeadline) throw new Error(`second.pdf not in ${DOWNLOADS}`);
    await sleep(500);
  }
  assert.equal(readFileSync(secondPath).subarray(0, 5).toString(), "%PDF-");
  ok(`second.pdf ${readFileSync(secondPath).length} bytes`);

  step("repo home README");
  await navigate(README_REPO);
  await pollScript(
    `return document.querySelectorAll('#makespdf-download-pdf-host #makespdf-download-pdf-button').length;`,
    "home button present",
  );
  ok("home button present");

  await marionette.send("WebDriver:DeleteSession");
  marionette.socket.end();
} catch (error) {
  failed = true;
  console.error(`\nFIREFOX SMOKE FAILED: ${error instanceof Error ? error.message : String(error)}`);
  try {
    console.error("--- web-ext log tail ---");
    console.error(readFileSync(LOG, "utf8").split("\n").slice(-25).join("\n"));
  } catch {
    // log may not exist
  }
} finally {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // already gone
  }
  await sleep(1_000);
}

if (failed) process.exit(1);
console.log(`\nFIREFOX SMOKE PASSED (artifacts in ${OUT})`);
