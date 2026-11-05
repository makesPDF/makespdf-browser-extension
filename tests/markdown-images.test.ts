import { describe, expect, it } from "vitest";
import { AssetError } from "../src/lib/assets";
import {
  MAX_IMAGE_COUNT,
  findRelativeRefs,
  formatImageFailure,
  inlineRelativeImages,
  prepareExportMarkdown,
} from "../src/lib/markdown-images";

const okResolve = async (src: string) => `data:image/png;base64,RESOLVED(${src})`;

describe("findRelativeRefs", () => {
  it("finds Markdown and HTML image references in document order", () => {
    const markdown = [
      "![one](./a.png)",
      '<img src="b.png" width="100">',
      "![three](<c.png>)",
      "![four](d.png \"title\")",
    ].join("\n\n");
    expect(findRelativeRefs(markdown)).toEqual(["./a.png", "b.png", "c.png", "d.png"]);
  });

  it("ignores absolute URLs, data URIs, protocol-relative and fragment refs", () => {
    const markdown = [
      "![remote](https://example.com/x.png)",
      "![proto](//cdn.example.com/x.png)",
      "![inline](data:image/png;base64,AAAA)",
      "![anchor](#section)",
    ].join("\n");
    expect(findRelativeRefs(markdown)).toEqual([]);
  });

  it("ignores image-like text inside fenced and inline code", () => {
    const markdown = [
      "```",
      "![not real](./fenced.png)",
      "```",
      "`![also not](./inline.png)`",
      "![real](./real.png)",
    ].join("\n");
    expect(findRelativeRefs(markdown)).toEqual(["./real.png"]);
  });

  it("deduplicates repeated references", () => {
    expect(findRelativeRefs("![a](x.png)\n![b](x.png)")).toEqual(["x.png"]);
  });
});

describe("inlineRelativeImages", () => {
  it("replaces both syntaxes with the resolved data URI", async () => {
    const markdown = '![shot](./img/shot.png)\n\n<img src="img/shot.png" alt="shot">';
    const { markdown: out, failures } = await inlineRelativeImages(markdown, okResolve);
    expect(failures).toEqual([]);
    expect(out).toBe(
      '![shot](data:image/png;base64,RESOLVED(./img/shot.png))\n\n<img src="data:image/png;base64,RESOLVED(img/shot.png)" alt="shot">',
    );
  });

  it("finds paths with parentheses in every destination form", () => {
    expect(
      findRelativeRefs(
        '![a](a(b).png) ![b](c\\(d\\).png) ![c](<e (f).png>) ![d](g%20(h).png) ![e](u(v.png) ![f](<x\\>y.png>)',
      ),
    ).toEqual(["a(b).png", "c(d).png", "e (f).png", "g%20(h).png", "u(v.png", "x>y.png"]);
  });

  it("finds nested parentheses and an unescaped < in full", () => {
    expect(findRelativeRefs("![a](a((b)).png) ![b](a(b(c)d).png) ![c](<a<b c.png>)")).toEqual([
      "a((b)).png",
      "a(b(c)d).png",
      "a<b c.png",
    ]);
  });

  it("does not make a path from a backslash before a space", () => {
    expect(findRelativeRefs("![a](my\\ photo.png)")).toEqual([]);
  });

  it("keeps a backslash before a parenthesis inside angle brackets", () => {
    expect(findRelativeRefs("![a](<pics\\(1).png>)")).toEqual(["pics\\(1).png"]);
  });

  it("embeds a path with parentheses and keeps what follows the image", async () => {
    const { markdown, failures } = await inlineRelativeImages(
      '![a](a(b).png "the (title)") (see above) ![b](plain.png) (note)',
      okResolve,
    );
    expect(markdown).toBe(
      '![a](data:image/png;base64,RESOLVED(a(b).png) "the (title)") (see above) ![b](data:image/png;base64,RESOLVED(plain.png)) (note)',
    );
    expect(failures).toEqual([]);
  });

  it("does not treat an img src as a markdown destination", () => {
    expect(findRelativeRefs('<img src="a\\(b\\).png">')).toEqual(["a\\(b\\).png"]);
  });

  it("does not stall on an unterminated destination", () => {
    for (const tail of ["(a)".repeat(50_000), "((a)".repeat(50_000), "\\(".repeat(50_000), " ".repeat(160_000)]) {
      const started = Date.now();
      findRelativeRefs(`![x](${tail}`);
      expect(Date.now() - started).toBeLessThan(2000);
    }
  });

  it("leaves a multi-megabyte data URI alone", () => {
    const data = `data:image/png;base64,${"A".repeat(16_000_000)}`;
    expect(findRelativeRefs(`![x](${data})`)).toEqual([]);
    expect(findRelativeRefs(`![x](<${data}>)`)).toEqual([]);
  });

  it("preserves a Markdown title after the URL", async () => {
    const { markdown: out } = await inlineRelativeImages('![shot](shot.png "the title")', okResolve);
    expect(out).toBe('![shot](data:image/png;base64,RESOLVED(shot.png) "the title")');
  });

  it("leaves absolute references untouched", async () => {
    const markdown = "![remote](https://example.com/x.png)";
    const { markdown: out, failures } = await inlineRelativeImages(markdown, okResolve);
    expect(out).toBe(markdown);
    expect(failures).toEqual([]);
  });

  it("reports an AssetError's reason against the reference", async () => {
    const resolve = async (src: string) => {
      throw new AssetError("could not be fetched (HTTP 404)", src);
    };
    const { failures } = await inlineRelativeImages("![a](missing.png)\n![b](also.png)", resolve);
    expect(failures).toEqual([
      { src: "missing.png", reason: "could not be fetched (HTTP 404)" },
      { src: "also.png", reason: "could not be fetched (HTTP 404)" },
    ]);
  });

  it("reports a non-AssetError rejection as a fetch failure", async () => {
    const resolve = async () => {
      throw new TypeError("Failed to fetch");
    };
    const { failures } = await inlineRelativeImages("![a](x.png)", resolve);
    expect(failures).toEqual([{ src: "x.png", reason: "could not be fetched" }]);
  });
});

describe("formatImageFailure", () => {
  it("returns null when nothing failed", () => {
    expect(formatImageFailure([])).toBeNull();
  });

  it("names a single failed reference, following the VS Code plugin's wording", () => {
    expect(formatImageFailure([{ src: "img/shot.png", reason: "could not be fetched (HTTP 404)" }])).toBe(
      "Export stopped, no PDF was written: 1 image could not be embedded: " +
        "img/shot.png (could not be fetched (HTTP 404)). " +
        "Fix or remove the reference and export again.",
    );
  });

  it("names several and counts the rest beyond ten", () => {
    const failures = Array.from({ length: 12 }, (_, i) => ({ src: `img/${i}.png`, reason: "could not be fetched" }));
    const message = formatImageFailure(failures);
    expect(message).toContain("12 images could not be embedded");
    expect(message).toContain("img/0.png (could not be fetched)");
    expect(message).toContain("and 2 more");
  });
});

describe("prepareExportMarkdown", () => {
  it("stops with a named count above the 20-image cap", async () => {
    const markdown = Array.from({ length: MAX_IMAGE_COUNT + 1 }, (_, i) => `![img](img/${i}.png)`).join("\n");
    const result = await prepareExportMarkdown(markdown, okResolve);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(`references ${MAX_IMAGE_COUNT + 1} images`);
      expect(result.message).toContain(`at most ${MAX_IMAGE_COUNT} can be`);
    }
  });

  it("counts absolute images toward the cap too, matching the server's all-src count", async () => {
    const markdown = Array.from({ length: MAX_IMAGE_COUNT - 1 }, (_, i) => `![img](img/${i}.png)`)
      .concat([
        "![one](https://example.com/one.png)",
        "![two](https://example.com/two.png)",
      ])
      .join("\n");
    const result = await prepareExportMarkdown(markdown, okResolve);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(`references ${MAX_IMAGE_COUNT + 1} images`);
  });

  it("passes at the cap with a mix of relative and absolute refs, leaving the absolute ones alone", async () => {
    const markdown = Array.from({ length: MAX_IMAGE_COUNT - 1 }, (_, i) => `![img](img/${i}.png)`)
      .concat(["![remote](https://example.com/one.png)"])
      .join("\n");
    const result = await prepareExportMarkdown(markdown, okResolve);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.markdown).toContain("![remote](https://example.com/one.png)");
  });

  it("stops with the image message when any reference fails", async () => {
    const resolve = async (src: string) => {
      if (src === "bad.png") throw new AssetError("too large to embed, max 5MB", src);
      return "data:image/png;base64,AA==";
    };
    const result = await prepareExportMarkdown("![ok](good.png)\n![bad](bad.png)", resolve);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("bad.png (too large to embed, max 5MB)");
  });
});
