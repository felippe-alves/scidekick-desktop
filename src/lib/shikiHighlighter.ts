import type { HighlighterCore } from "shiki/core";

// Syntax highlighting for fenced code blocks, via Shiki's pure-JavaScript regex
// engine (NOT the WASM/oniguruma engine — that would need `wasm-unsafe-eval`,
// which our `script-src 'self'` CSP forbids; the JS engine only uses `new RegExp`).
//
// Everything is dynamically imported so Shiki + its grammars land in a lazy chunk
// loaded on the first code block, not in the main bundle. The highlighter is a
// memoized singleton: grammars/theme load once, then `codeToHtml` is synchronous.

const THEME = "github-dark-default";

// Canonical grammar id -> lazy grammar import. Curated for a research/coding tool.
const LANG_LOADERS = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
} as const;

type LangId = keyof typeof LANG_LOADERS;

const ALIASES: Record<string, LangId> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  zsh: "bash",
  console: "bash",
  yml: "yaml",
  md: "markdown",
  rs: "rust",
};

function canonical(lang: string | undefined): LangId | null {
  if (!lang) return null;
  const l = lang.toLowerCase();
  if (l in LANG_LOADERS) return l as LangId;
  return ALIASES[l] ?? null;
}

/** Whether a fenced-code language tag maps to a grammar we bundle. */
export function isSupportedLang(lang: string | undefined): boolean {
  return canonical(lang) !== null;
}

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, theme, ...langMods] =
        await Promise.all([
          import("shiki/core"),
          import("shiki/engine/javascript"),
          import("shiki/themes/github-dark-default.mjs"),
          ...Object.values(LANG_LOADERS).map((load) => load()),
        ]);
      return createHighlighterCore({
        themes: [theme.default],
        langs: langMods.map((m) => m.default),
        // forgiving: don't throw if a grammar uses a regex construct the JS
        // engine can't compile — degrade that token instead of failing the block.
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      });
    })();
  }
  return highlighterPromise;
}

/**
 * Highlight `code` as `lang`, returning a Shiki `<pre class="shiki">…</pre>` HTML
 * string. Returns null when the language isn't one we bundle, so callers can fall
 * back to a plain (escaped) code block. Shiki escapes the code, so the returned
 * HTML is safe to inject.
 */
export async function highlightToHtml(code: string, lang: string | undefined): Promise<string | null> {
  const id = canonical(lang);
  if (!id) return null;
  try {
    const hl = await getHighlighter();
    return hl.codeToHtml(code, { lang: id, theme: THEME });
  } catch {
    return null;
  }
}
