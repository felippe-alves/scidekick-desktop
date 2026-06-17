import { describe, expect, it } from "vitest";
import { highlightToHtml, isSupportedLang } from "./shikiHighlighter";

describe("isSupportedLang", () => {
  it("accepts bundled languages and their aliases", () => {
    expect(isSupportedLang("python")).toBe(true);
    expect(isSupportedLang("ts")).toBe(true); // alias -> typescript
    expect(isSupportedLang("PY")).toBe(true); // case-insensitive
    expect(isSupportedLang("sh")).toBe(true); // alias -> bash
  });

  it("rejects unbundled or missing languages", () => {
    expect(isSupportedLang("brainfuck")).toBe(false);
    expect(isSupportedLang(undefined)).toBe(false);
    expect(isSupportedLang("")).toBe(false);
  });
});

describe("highlightToHtml", () => {
  it("highlights supported code into Shiki spans", async () => {
    const out = await highlightToHtml("const x = 1;", "ts");
    expect(out).not.toBeNull();
    expect(out).toContain('class="shiki');
    expect(out).toContain("<span"); // tokenised
    expect(out).toContain("color:"); // inline theme colors
    expect(out).toContain("const");
  });

  it("escapes HTML in the source so injection is impossible", async () => {
    const out = await highlightToHtml("const a = b < c && d > e;", "ts");
    expect(out).not.toBeNull();
    // Shiki encodes `<` (numeric or named entity) so it can never open a tag.
    expect(out).toMatch(/&lt;|&#x3c;/i);
    expect(out).not.toContain("b < c"); // raw angle bracket never survives as text
  });

  it("returns null for unsupported languages so the caller can fall back", async () => {
    expect(await highlightToHtml("whatever", "no-such-lang")).toBeNull();
    expect(await highlightToHtml("whatever", undefined)).toBeNull();
  });
});
