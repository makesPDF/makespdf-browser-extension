/**
 * Manifest composition for the two packages this build produces.
 *
 * Shared by `scripts/build.mjs` and the unit tests, so the invariants the
 * tests pin (service worker vs. event page, the Gecko id) are the same ones
 * the build writes.
 */

/** The build targets, in build order. */
export const TARGETS = ["chromium", "firefox"];

/**
 * Fields both packages share. The `version` is filled from package.json at
 * build time; `background` and (for Firefox) `browser_specific_settings` are
 * target-specific and added by `manifestFor`.
 *
 * Permissions stay minimal for the MVP:
 *   - `storage`: the options page (API key, page size, theme).
 *   - content script on github.com: the adapter's page.
 *   - host permission for makespdf.com: the render POST from the background.
 * No `<all_urls>`, no `downloads`: the PDF is saved with an object-URL anchor.
 */
export const BASE_MANIFEST = {
  manifest_version: 3,
  name: "makesPDF — Markdown to PDF",
  description:
    "Download GitHub Markdown files as PDF with makesPDF. Renders READMEs and .md files with images intact.",
  permissions: ["storage"],
  host_permissions: ["https://makespdf.com/*"],
  content_scripts: [
    {
      matches: ["https://github.com/*"],
      js: ["content.js"],
      run_at: "document_idle",
    },
  ],
  options_ui: {
    page: "options/options.html",
    open_in_tab: true,
  },
  action: {
    default_title: "makesPDF options",
  },
};

/**
 * The manifest for one target.
 *
 * Chrome runs the background as a module service worker; Firefox does not
 * support `background.service_worker` and uses a module event page instead
 * (Firefox 111+; `strict_min_version` pins the floor). Firefox also needs a
 * stable extension id for storage and updates.
 */
export function manifestFor(target, version) {
  if (target === "chromium") {
    return {
      ...BASE_MANIFEST,
      version,
      background: { service_worker: "background.js", type: "module" },
    };
  }
  if (target === "firefox") {
    return {
      ...BASE_MANIFEST,
      version,
      background: { scripts: ["background.js"], type: "module" },
      browser_specific_settings: {
        gecko: {
          id: "browser-extension@makespdf.com",
          strict_min_version: "115.0",
        },
      },
    };
  }
  throw new Error(`unknown build target: ${target}`);
}
