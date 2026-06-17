// Pure extraction of the figures a marimo_run tool result carries. The engine puts
// `figures: [{ id, title, path }]` (path workspace-relative) in the tool result's
// `details`; the GUI reads each file via the read_file_base64 Tauri command and shows
// it inline. Tolerant of older engines that don't emit `figures`.

export interface FigureRef {
  id: string;
  title: string;
  path: string;
}

/** Returns the figures from a marimo_run AgentToolResult, or null if there are none. */
export function extractFigures(result: unknown): FigureRef[] | null {
  const details = (result as { details?: unknown } | null | undefined)?.details;
  if (!details || typeof details !== "object") return null;
  const raw = (details as Record<string, unknown>).figures;
  if (!Array.isArray(raw)) return null;

  const figures: FigureRef[] = raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .filter((f) => typeof f.path === "string" && (f.path as string).trim() !== "")
    .map((f) => ({
      id: typeof f.id === "string" ? f.id : (f.path as string),
      title: typeof f.title === "string" ? f.title : (f.path as string),
      path: f.path as string,
    }));

  return figures.length ? figures : null;
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

/** Whether a figure path is an image we can render inline (vs. e.g. a PDF). */
export function isRenderableImage(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.includes(ext);
}
