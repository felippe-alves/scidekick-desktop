import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { type FigureRef, isRenderableImage } from "../lib/figureView";
import { readFileBase64 } from "../lib/tauri";

// Renders the figures a marimo_run produced. Each image is read from disk via the
// read_file_base64 Tauri command and shown as a `data:` URI (the CSP permits
// img-src 'self' data:). Non-image figures (e.g. PDF) get a path placeholder.

export function FigureCard({ workspacePath, figures }: { workspacePath: string; figures: FigureRef[] }) {
  return (
    <div className="figure-card">
      {figures.map((fig) => (
        <Figure key={fig.id} workspacePath={workspacePath} fig={fig} />
      ))}
    </div>
  );
}

function Figure({ workspacePath, fig }: { workspacePath: string; fig: FigureRef }) {
  const renderable = isRenderableImage(fig.path);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!renderable || !workspacePath) return;
    let cancelled = false;
    setSrc(null);
    setError(null);
    readFileBase64(workspacePath, fig.path)
      .then((data) => {
        if (!cancelled) setSrc(`data:${data.mime};base64,${data.base64}`);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath, fig.path, renderable]);

  return (
    <figure className="figure-item">
      {renderable && src ? (
        <img src={src} alt={fig.title} loading="lazy" />
      ) : (
        <div className="figure-placeholder">
          <ImageOff size={14} />
          <span>{error ? "could not load" : renderable ? "loading…" : "not previewable"}</span>
        </div>
      )}
      <figcaption title={fig.path}>{fig.title}</figcaption>
    </figure>
  );
}
