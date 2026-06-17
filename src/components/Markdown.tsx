import { memo, type MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

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
  a({ children, href, ...props }) {
    return (
      <a {...props} href={href} target="_blank" rel="noreferrer noopener" onClick={openExternal}>
        {children}
      </a>
    );
  },
};

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
