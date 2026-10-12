/**
 * The build target a package was built for.
 *
 * `__BUILD_TARGET__` is replaced at build time by esbuild (`define` in
 * `scripts/build.mjs`); under vitest it is undefined and the fallback keeps
 * module imports safe. The target is what labels the `X-MakesPDF-Client`
 * header — `chromium` for the Chrome/Edge/Brave package, `firefox` for the
 * Firefox package (operator decision 2026-10-09: label by build, not brand).
 */

export type BuildTarget = "chromium" | "firefox";

declare const __BUILD_TARGET__: BuildTarget | undefined;
declare const __EXTENSION_VERSION__: string | undefined;

// `typeof` on a declare-only identifier is safe when esbuild's define did not
// replace it (tests): it evaluates to the string "undefined".
function readBuildTarget(): BuildTarget {
  return typeof __BUILD_TARGET__ === "string" ? __BUILD_TARGET__ : "chromium";
}

function readExtensionVersion(): string {
  return typeof __EXTENSION_VERSION__ === "string" ? __EXTENSION_VERSION__ : "0.0.0";
}

export const BUILD_TARGET: BuildTarget = readBuildTarget();

/**
 * The extension version this bundle was built from (package.json, via the
 * build's `define`; the same value the manifest carries).
 */
export const EXTENSION_VERSION: string = readExtensionVersion();

/**
 * The `X-MakesPDF-Client` value for one build:
 * `browser-extension/<version>+<build>`. `inferClient` on the server accepts
 * the `+` in the version pattern and buckets the kind as `browser-extension`
 * (operator decision 2026-10-09: label by build, not brand).
 *
 * The build's `define`s are spelled inline — not via the `EXTENSION_VERSION` /
 * `BUILD_TARGET` consts — so esbuild folds the concatenation into the exact
 * header literal, and each package's bundle can be checked for it by
 * `scripts/verify-packages.mjs` and the build-output test. In the test
 * environment (no defines) the condition is false and the sensible fallback
 * exercises the same `clientHeader` format.
 */
export const CLIENT_HEADER: string =
  typeof __EXTENSION_VERSION__ === "string" && typeof __BUILD_TARGET__ === "string"
    ? "browser-extension/" + __EXTENSION_VERSION__ + "+" + __BUILD_TARGET__
    : clientHeader("0.0.0", "chromium");

/** The header format; the build substitutes it inline above. */
export function clientHeader(version: string, build: BuildTarget): string {
  return "browser-extension/" + version + "+" + build;
}
