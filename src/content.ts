/**
 * Content script entry: runs on github.com pages and wires the page
 * controller. All the logic lives in lib/controller.ts so it can be unit
 * tested with jsdom.
 */

import browser from "webextension-polyfill";
import { startController } from "./lib/controller";
import type { RenderRequest, RenderResponse } from "./lib/messages";

startController({
  document,
  location: window.location,
  sendMessage: (request: RenderRequest) =>
    browser.runtime.sendMessage(request) as Promise<RenderResponse>,
});
