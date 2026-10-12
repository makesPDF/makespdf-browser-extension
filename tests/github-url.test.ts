import { describe, expect, it } from "vitest";
import { matchGitHubMarkdown, sanitizeFilename } from "../src/lib/github-url";

describe("matchGitHubMarkdown", () => {
  it("matches a blob view of a .md file", () => {
    const target = matchGitHubMarkdown("https://github.com/makesPDF/makespdf-vscode-plugin/blob/main/README.md");
    expect(target).toEqual({
      kind: "blob",
      owner: "makesPDF",
      repo: "makespdf-vscode-plugin",
      rawUrl: "https://github.com/makesPDF/makespdf-vscode-plugin/raw/main/README.md",
      rawDirUrl: "https://github.com/makesPDF/makespdf-vscode-plugin/raw/main/",
      rootRawDirUrl: "https://github.com/makesPDF/makespdf-vscode-plugin/raw/main/",
      filename: "README.pdf",
    });
  });

  it("matches .markdown case-insensitively and nested directories", () => {
    const target = matchGitHubMarkdown("https://github.com/acme/docs/blob/v2.1.0/guide/Intro.MARKDOWN");
    expect(target?.rawUrl).toBe("https://github.com/acme/docs/raw/v2.1.0/guide/Intro.MARKDOWN");
    expect(target?.rawDirUrl).toBe("https://github.com/acme/docs/raw/v2.1.0/guide/");
    expect(target?.filename).toBe("Intro.pdf");
  });

  it("keeps refs containing slashes in the raw URL", () => {
    const target = matchGitHubMarkdown("https://github.com/acme/docs/blob/feature/new-flow/docs/setup.md");
    expect(target?.rawUrl).toBe("https://github.com/acme/docs/raw/feature/new-flow/docs/setup.md");
    expect(target?.rawDirUrl).toBe("https://github.com/acme/docs/raw/feature/new-flow/docs/");
  });

  it("ignores query strings and fragments", () => {
    const target = matchGitHubMarkdown("https://github.com/acme/docs/blob/main/readme.md?plain=1#L10");
    expect(target?.rawUrl).toBe("https://github.com/acme/docs/raw/main/readme.md");
    expect(target?.filename).toBe("readme.pdf");
  });

  it("percent-decodes the suggested filename and sanitizes it", () => {
    const target = matchGitHubMarkdown("https://github.com/acme/docs/blob/main/My%20Notes%20%2F%20Draft.md");
    expect(target?.filename).toBe("My Notes - Draft.pdf");
  });

  it("does not match non-markdown blob files", () => {
    expect(matchGitHubMarkdown("https://github.com/acme/docs/blob/main/index.ts")).toBeNull();
    expect(matchGitHubMarkdown("https://github.com/acme/docs/blob/main/readme.md.txt")).toBeNull();
  });

  it("does not match tree (directory) views, even when the directory is named *.md", () => {
    expect(matchGitHubMarkdown("https://github.com/acme/docs/tree/main/docs")).toBeNull();
    expect(matchGitHubMarkdown("https://github.com/acme/docs/blob/main/notes.md/")).toBeNull();
  });

  it("matches the repo home page and points at the default-branch README", () => {
    const target = matchGitHubMarkdown("https://github.com/makesPDF/makespdf-browser-extension");
    expect(target).toEqual({
      kind: "home",
      owner: "makesPDF",
      repo: "makespdf-browser-extension",
      rawUrl: "https://github.com/makesPDF/makespdf-browser-extension/raw/HEAD/README.md",
      rawDirUrl: "https://github.com/makesPDF/makespdf-browser-extension/raw/HEAD/",
      rootRawDirUrl: "https://github.com/makesPDF/makespdf-browser-extension/raw/HEAD/",
      filename: "makespdf-browser-extension.pdf",
    });
    expect(matchGitHubMarkdown("https://github.com/makesPDF/makespdf-browser-extension/")?.kind).toBe("home");
  });

  it("does not match GitHub's own top-level routes", () => {
    for (const path of ["/settings/profile", "/explore", "/notifications", "/orgs/acme", "/marketplace", "/search?q=x"]) {
      expect(matchGitHubMarkdown(`https://github.com${path}`)).toBeNull();
    }
  });

  it("does not match other hosts, schemes or shapes", () => {
    expect(matchGitHubMarkdown("https://gist.github.com/acme/1234")).toBeNull();
    expect(matchGitHubMarkdown("http://github.com/acme/docs/blob/main/readme.md")).toBeNull();
    expect(matchGitHubMarkdown("https://github.com/acme")).toBeNull();
    expect(matchGitHubMarkdown("https://github.com/acme/docs/blob/main")).toBeNull();
    expect(matchGitHubMarkdown("https://github.com/acme/docs/issues/12")).toBeNull();
    expect(matchGitHubMarkdown("not a url")).toBeNull();
  });
});

describe("sanitizeFilename", () => {
  it("strips path separators and reserved characters", () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j.pdf')).toBe("a-b-c-d-e-f-g-h-i-j.pdf");
  });

  it("collapses whitespace and never returns an empty name", () => {
    expect(sanitizeFilename("  spaced   name.md  ")).toBe("spaced name.md");
    expect(sanitizeFilename("///")).toBe("---");
    expect(sanitizeFilename("")).toBe("document.pdf");
  });
});
