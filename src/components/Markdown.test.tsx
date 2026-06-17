import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

// react-markdown + the remark/rehype plugins render synchronously, so we can assert
// the produced HTML with renderToStaticMarkup — no DOM or testing-library needed.
const html = (md: string) => renderToStaticMarkup(<Markdown>{md}</Markdown>);

describe("Markdown", () => {
  it("renders CommonMark: bold, headings, and inline code", () => {
    const out = html("# Title\n\nsome **bold** and `inline()` code");
    expect(out).toContain("<h1>Title</h1>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<code>inline()</code>");
  });

  it("renders unordered and ordered lists", () => {
    const out = html("- one\n- two\n\n1. first\n2. second");
    expect(out).toContain("<ul>");
    expect(out).toContain("<li>one</li>");
    expect(out).toContain("<ol>");
    expect(out).toContain("<li>first</li>");
  });

  it("renders fenced code blocks (Shiki highlighting is async, so static render hits the plain fallback)", () => {
    // Shiki highlights in a useEffect; renderToStaticMarkup runs no effects, so we
    // get the escaped plain-code fallback carrying the language tag.
    const out = html("```ts\nconst x = 1;\n```");
    expect(out).toContain('data-lang="ts"');
    expect(out).toContain("code-block");
    expect(out).toContain("const x = 1;");
  });

  it("renders GFM tables and strikethrough", () => {
    const out = html("| a | b |\n| - | - |\n| 1 | 2 |\n\n~~gone~~");
    expect(out).toContain("<table>");
    expect(out).toContain("<th>a</th>");
    expect(out).toContain("<td>1</td>");
    expect(out).toContain("<del>gone</del>");
  });

  it("renders inline and display LaTeX math via KaTeX", () => {
    const inline = html("mass-energy: $E = mc^2$");
    expect(inline).toContain('class="katex"');
    // Canonical display form: $$ on its own lines → block math → katex-display.
    const display = html("$$\n\\int_0^1 x\\,dx = \\frac{1}{2}\n$$");
    expect(display).toContain("katex-display");
  });

  it("makes links open externally and safely", () => {
    const out = html("see [paper](https://example.com/doi)");
    expect(out).toContain('href="https://example.com/doi"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noreferrer noopener"');
  });

  it("does not render raw HTML from model output (no rehype-raw)", () => {
    const out = html('hi <script>alert(1)</script> <img src=x onerror="evil()">');
    // No live tags reach the DOM — they survive only as escaped text.
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&lt;img");
  });
});
