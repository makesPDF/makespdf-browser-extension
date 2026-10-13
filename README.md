# makesPDF browser extension

Download GitHub Markdown files as PDF with [makesPDF](https://makespdf.com).
On a `.md` / `.markdown` file view — and on a repo home page's rendered README
— the extension injects a **Download PDF** button that saves
`<file-stem>.pdf`.

Manifest V3, TypeScript, one build producing a Chrome/Chromium package and a
Firefox package.

## Install (development)

```bash
npm install
npm run build
```

- **Chrome / Edge / Brave**: `chrome://extensions` → enable Developer mode →
  **Load unpacked** → `dist/chromium`.
- **Firefox**: `about:debugging#/runtime/this-firefox` → **Load Temporary
  Add-on** → `dist/firefox/manifest.json`.

`npm run build` also writes `dist/makespdf-chromium-<version>.zip` and
`dist/makespdf-firefox-<version>.zip` for distribution.

## Usage

1. Open any Markdown file on GitHub (`github.com/<owner>/<repo>/blob/<ref>/<path>.md`)
   or a repository home page with a README.
2. Press **Download PDF** in the file header (repo home: bottom-right).
3. The PDF downloads as `<file-stem>.pdf`.

Works on public and private repositories: the Markdown and its relative images
are fetched through the browser's own GitHub session. Renders are **anonymous
by default**; add an API key in the options for your own rate limits.

## Options

The toolbar icon opens the options page (`chrome://extensions` → Details →
Extension options in Chrome; `about:addons` → Preferences in Firefox):

- **API key** — stored in `storage.local`: this browser only, never synced.
  Leave empty to render anonymously. Create one at
  <https://makespdf.com/settings/api-keys>.
- **Page size** — `A3`, `A4` (default), `A5`, `Letter`, `Legal`.
- **Theme** — `default` or `github`.

## Privacy

To render a PDF, the Markdown text of the file you export — including any
relative images embedded in it as `data:` URIs — is sent to makesPDF
(`https://makespdf.com/api/v1/md`). Anonymous renders are not stored. Renders
made with an API key are kept as a 7-day artifact on your account. No other
page data leaves your browser. Nothing is sent until you press **Download
PDF**.

The extension requests the minimum permissions it can:

| Permission | Why |
| --- | --- |
| `storage` | The options page's API key and defaults. |
| content script on `https://github.com/*` | The button, the Markdown fetch and the image fetches run in the page's session. |
| host permission for `https://makespdf.com/*` | The background POSTs the render request. |

No `<all_urls>`, no `downloads` permission (the PDF is saved with an
object-URL anchor), no analytics.

## How it works

```
content script (github.com)                    background (extension origin)
───────────────────────────                    ─────────────────────────────
match page → adapter
fetch raw Markdown (session cookies)
find relative images → fetch (session) → data:
/─────────── render request ──────────▶ POST https://makespdf.com/api/v1/md
                                         X-MakesPDF-Client: browser-extension/<version>+<build>
                                         Authorization: Bearer <key>  (only if saved)
◀────────── base64 PDF ────────────────  anonymous when no key
object-URL anchor → <file-stem>.pdf
```

- **GitHub soft navigation** (Turbo) is handled by re-checking on Turbo
  events, DOM mutations and a coarse interval; injection is idempotent, so a
  navigation never leaves two buttons or a button bound to the previous file.
- **Relative images** are resolved against the file's directory
  (`./`, `../`, nested dirs; `/`-rooted against the repo root) and inlined as
  `data:` URIs. `/md`'s limits are mirrored: **5 MB per image, 20 images per
  document**. If any image cannot be embedded the export stops and names it —
  a PDF silently missing an image is worse than no PDF (the VS Code plugin's
  MAK-191 precedent). Absolute `https:` images are left for the server.
- **Errors** mirror the wording of the VS Code/Zed clients: 401 with a saved
  key blames the key, anonymous 401 points at sign-up, 429 carries the
  server's tip, and 400/413 surface the server's message.
- **Adapters** (`src/adapters/`) are additive — MAK-197's later sources
  implement the same `MarkdownAdapter` interface
  (`matches`, `getMarkdown`, `resolveAsset`, `injectButton`,
  `suggestedFilename`) and register in `src/adapters/registry.ts`.

## Development

```bash
npm run typecheck        # tsc --noEmit
npm test                 # vitest: URL matching, path resolution, image
                         # limits, error mapping, header per package,
                         # built-package contents
npm run build            # dist/chromium + dist/firefox (+ zips)
npm run verify:packages  # structural checks over dist/ (loadability gate)
```

### Manual smoke

`smoke/` holds the public fixture (`fixture.md` + `logo.png`, plus
`second.md` for soft navigation) and a scripted Chromium pass over the built
package:

```bash
node smoke/chromium-smoke.mjs            # needs Playwright available; see the script
SMOKE_REF=<branch> node smoke/chromium-smoke.mjs   # while the fixture is unmerged
```

It loads `dist/chromium`, clicks the button on the fixture, checks the
downloaded PDF, soft-navigates to `second.md` and checks the button stays
singular.

The Firefox package has the same scripted smoke, driven through the real
Firefox over Marionette (`web-ext run` installs `dist/firefox` temporarily —
Playwright cannot load extensions in its Firefox):

```bash
node smoke/firefox-smoke.mjs                          # needs FIREFOX_BIN; see the script
SMOKE_REF=<branch> node smoke/firefox-smoke.mjs       # while the fixture is unmerged
```

It runs the same flow end to end (render, download, soft navigation, repo
home). Still manual on top of both scripts: a **private-repo** file with
relative images.

Unit tests cover URL matching (including refs containing `/`), relative path
resolution, the image limits and failure messages, the HTTP error mapping, the
`X-MakesPDF-Client` value per package (pinned both as a function and as a
literal in each built bundle), and the injected button's idempotence across
soft navigation.

### Limitations (MVP)

- GitHub only; `.md`/`.markdown` file views and repo-home READMEs.
- Inline images only: `![alt](./x.png)` and `<img src="...">`. Reference-style
  images (`![alt][id]` with `[id]: ./x.png`) are not inlined yet, so the
  server drops the unfetchable relative URL (it reports a layout warning).
- At most 20 relative images per document; more stops the export.
- Root-relative image paths (`/img.png`) are resolved at the first path
  segment after `/blob/` as the ref — refs containing `/` combined with
  root-relative images can resolve to the wrong directory.
- No extension icons yet (store builds need them).
