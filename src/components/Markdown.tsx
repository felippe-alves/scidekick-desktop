import { memo, useEffect, useState, type MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { highlightToHtml } from "../lib/shikiHighlighter";

// Rich-text rendering for assistant prose: GitHub-flavored Markdown + LaTeX math.
//
// Safety: react-markdown does NOT render raw HTML unless rehype-raw is added, so
// model output cannot inject markup. We deliberately omit rehype-raw. Links are
// rendered but never allowed to navigate the Tauri webview away from the app
// (that would unmount the whole SPA); http(s)/mailto links open in the OS browser
// instead. KaTeX CSS is bundled globally from main.tsx (`katex/dist/katex.min.css`),
// served from 'self' to satisfy the `style-src 'self' 'unsafe-inline'` CSP.

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

function openExternal(event: MouseEvent<HTMLAnchorElement>) {
  const href = event.currentTarget.getAttribute("href");
  if (!href) return;
  // Only hijack links that should leave the app. Let in-page anchors (#…) and
  // anything unusual fall through to the default (which CSP will contain anyway).
  if (/^(https?:|mailto:)/i.test(href)) {
    event.preventDefault();
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

const components: Components = {
  a({ node: _node, children, href, ...props }) {
    return (
      <a {...props} href={href} target="_blank" rel="noreferrer noopener" onClick={openExternal}>
        {children}
      </a>
    );
  },
  // Fenced code blocks render through CodeBlock (Shiki). We let `pre` pass its
  // child through unchanged so CodeBlock owns the container — no nested <pre>.
  pre({ children }) {
    return <>{children}</>;
  },
  code({ node: _node, className, children, ...props }) {
    const text = String(children ?? "");
    const lang = /language-(\w+)/.exec(className ?? "")?.[1];
    // Block code = tagged with a language, or multi-line. Everything else is
    // inline `code` (single back-ticked spans inside prose).
    if (lang || text.includes("\n")) {
      return <CodeBlock code={text.replace(/\n$/, "")} lang={lang} />;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    highlightToHtml(code, lang).then((out) => {
      if (!cancelled) setHtml(out);
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  // Shiki escapes the code; the only markup it adds is <span style="color:…">,
  // which the `style-src 'unsafe-inline'` CSP permits. Safe to inject.
  if (html) {
    return (
      <div
        className="code-block"
        data-lang={lang}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki-escaped, color-only spans
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  // Fallback before highlight resolves, or for unsupported/untagged languages.
  return (
    <pre className="code-block code-block-plain" data-lang={lang}>
      <code>{code}</code>
    </pre>
  );
}

function MarkdownImpl({ children }: { children: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

// Memoize on the raw text so streaming updates only re-parse when the text grows.
export const Markdown = memo(MarkdownImpl);
