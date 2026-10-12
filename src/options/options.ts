/**
 * Options page: API key, page size and theme defaults.
 *
 * The key is stored in `storage.local` — this browser only, never synced —
 * and is the only credential this extension holds. Leaving it empty means
 * anonymous renders (no key sent), which the service serves under its promo
 * carve-out with stricter limits.
 */

import browser from "webextension-polyfill";

const DEFAULT_PAGE_SIZE = "A4";
const DEFAULT_THEME = "default";

function input(id: string): HTMLInputElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement)) throw new Error(`missing input #${id}`);
  return element;
}

function select(id: string): HTMLSelectElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`missing select #${id}`);
  return element;
}

async function load(): Promise<void> {
  const stored = await browser.storage.local.get(["apiKey", "pageSize", "theme"]);
  input("api-key").value = typeof stored.apiKey === "string" ? stored.apiKey : "";
  select("page-size").value =
    typeof stored.pageSize === "string" && stored.pageSize ? stored.pageSize : DEFAULT_PAGE_SIZE;
  select("theme").value = typeof stored.theme === "string" && stored.theme ? stored.theme : DEFAULT_THEME;
}

function setStatus(message: string): void {
  const status = document.getElementById("status");
  if (status) status.textContent = message;
}

async function save(): Promise<void> {
  const apiKey = input("api-key").value.trim();
  const pageSize = select("page-size").value || DEFAULT_PAGE_SIZE;
  const theme = select("theme").value || DEFAULT_THEME;
  await browser.storage.local.set({ apiKey, pageSize, theme });
  setStatus(apiKey ? "Saved. Renders will use your API key." : "Saved. Renders are anonymous.");
}

document.addEventListener("DOMContentLoaded", () => {
  void load();
  document.getElementById("save")?.addEventListener("click", () => void save());
});
