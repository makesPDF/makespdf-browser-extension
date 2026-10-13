/**
 * Background entry: the render POST lives here (extension origin + host
 * permission), and the toolbar button opens the options page. The logic lives
 * in lib/render-client.ts so it can be unit tested without a browser.
 */

import browser from "webextension-polyfill";
import { CLIENT_HEADER } from "./lib/build-target";
import { boundFetch } from "./lib/fetch";
import { RENDER_MESSAGE_TYPE, type RenderRequest } from "./lib/messages";
import { renderMarkdown, type StoredDefaults } from "./lib/render-client";

function isRenderRequest(message: unknown): message is RenderRequest {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === RENDER_MESSAGE_TYPE
  );
}

browser.runtime.onMessage.addListener((message: unknown) => {
  if (!isRenderRequest(message)) return undefined;
  return renderMarkdown(message, {
    fetchImpl: boundFetch(),
    clientHeaderValue: CLIENT_HEADER,
    getApiKey: async () => {
      const stored = await browser.storage.local.get("apiKey");
      const key: unknown = stored.apiKey;
      return typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
    },
    getStoredDefaults: async (): Promise<StoredDefaults> => {
      const stored = await browser.storage.local.get(["pageSize", "theme"]);
      const defaults: StoredDefaults = {};
      if (typeof stored.pageSize === "string" && stored.pageSize) defaults.pageSize = stored.pageSize;
      if (typeof stored.theme === "string" && stored.theme) defaults.theme = stored.theme;
      return defaults;
    },
  });
});

browser.action.onClicked.addListener(() => {
  void browser.runtime.openOptionsPage();
});
