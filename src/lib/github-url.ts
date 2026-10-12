/**
 * URL matching for GitHub Markdown views, and the raw URLs derived from them.
 *
 * Two shapes are supported:
 *   - blob file views   https://github.com/<owner>/<repo>/blob/<ref...>/<path>.md
 *   - repo home README  https://github.com/<owner>/<repo>
 *
 * The Markdown source is never scraped from the rendered page: the raw URL is
 * derived from the page URL by swapping `/blob/` for `/raw/`, which GitHub
 * resolves server-side — including for refs that contain `/`, which a client
 * cannot split from the file path reliably. `rawDirUrl` is the same URL
 * truncated to the file's directory, used as the base for relative images.
 */

export interface GitHubMarkdownTarget {
  kind: "blob" | "home";
  owner: string;
  repo: string;
  /** Absolute https URL the Markdown source is fetched from. */
  rawUrl: string;
  /** Raw URL of the source file's directory, ending in "/" — base for relative assets. */
  rawDirUrl: string;
  /**
   * Repo-root raw URL at the same revision, ending in "/" — base for
   * `/`-rooted asset paths. Best effort: the revision is taken as the first
   * path segment after `/blob/`, which is wrong only for slash-containing
   * refs combined with root-relative image paths.
   */
  rootRawDirUrl: string;
  /** Suggested download filename, e.g. "README.pdf". */
  filename: string;
}

/**
 * Paths that can appear at the first two segments of a github.com URL without
 * the first being a repository owner. Not an allow-list opportunity — GitHub
 * owns new top-level routes over time — but it keeps the button off Settings,
 * Explore and friends.
 */
const RESERVED_FIRST_SEGMENTS = new Set([
  "about",
  "account",
  "apps",
  "codespaces",
  "collections",
  "contact",
  "customer-stories",
  "dashboard",
  "discussions",
  "enterprise",
  "explore",
  "features",
  "gist",
  "issues",
  "join",
  "login",
  "logout",
  "manifest.json",
  "marketplace",
  "new",
  "notifications",
  "organizations",
  "orgs",
  "pricing",
  "pulls",
  "readme",
  "search",
  "security",
  "settings",
  "signup",
  "site",
  "sponsors",
  "stars",
  "team",
  "teams",
  "topics",
  "trending",
  "users",
  "watching",
]);

/** Repo names GitHub allows: alphanumerics, `-`, `_`, `.` (not `.`/`..`). */
function isRepoName(segment: string): boolean {
  if (segment === "." || segment === "..") return false;
  return /^[A-Za-z0-9._-]+$/.test(segment);
}

const MARKDOWN_FILE_RE = /\.(?:md|markdown)$/i;

/** Characters a filename cannot carry across common filesystems/browsers. */
const UNSAFE_FILENAME_RE = /[\\/:*?"<>|\u0000-\u001f]/g;

/** A download-safe filename: no separators, no control characters, non-empty. */
export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(UNSAFE_FILENAME_RE, "-").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : "document.pdf";
}

/** The file stem of a markdown file segment, percent-decoded and sanitized. */
function stemFor(filenameSegment: string): string {
  let decoded = filenameSegment;
  try {
    decoded = decodeURIComponent(filenameSegment);
  } catch {
    // Malformed escapes: fall back to the raw segment.
  }
  return sanitizeFilename(decoded.replace(MARKDOWN_FILE_RE, ""));
}

/**
 * Match a github.com URL against the supported Markdown views. Returns the
 * target (with raw URLs precomputed) or null when the page has no Markdown
 * source this extension can fetch.
 */
export function matchGitHubMarkdown(input: URL | string): GitHubMarkdownTarget | null {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input) : input;
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com") return null;

  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2) return null;
  const owner = segments[0] ?? "";
  const repo = segments[1] ?? "";
  if (RESERVED_FIRST_SEGMENTS.has(owner.toLowerCase())) return null;
  if (owner.length === 0 || !isRepoName(repo)) return null;

  const base = `${url.origin}/${owner}/${repo}`;

  // Repo home: the rendered README lives here. HEAD follows the default branch.
  if (segments.length === 2) {
    return {
      kind: "home",
      owner,
      repo,
      rawUrl: `${base}/raw/HEAD/README.md`,
      rawDirUrl: `${base}/raw/HEAD/`,
      rootRawDirUrl: `${base}/raw/HEAD/`,
      filename: `${sanitizeFilename(repo)}.pdf`,
    };
  }

  // Blob file view. A trailing slash is a directory (tree) view, not a file.
  if (segments[2] !== "blob" || segments.length < 4) return null;
  if (url.pathname.endsWith("/")) return null;
  const fileSegment = segments[segments.length - 1] ?? "";
  if (!MARKDOWN_FILE_RE.test(fileSegment)) return null;

  const pathAfterBlob = segments.slice(3).join("/");
  const rawUrl = `${base}/raw/${pathAfterBlob}`;
  const firstRefSegment = segments[3] ?? "";

  return {
    kind: "blob",
    owner,
    repo,
    rawUrl,
    rawDirUrl: rawUrl.slice(0, rawUrl.lastIndexOf("/") + 1),
    rootRawDirUrl: `${base}/raw/${firstRefSegment}/`,
    filename: `${stemFor(fileSegment)}.pdf`,
  };
}
