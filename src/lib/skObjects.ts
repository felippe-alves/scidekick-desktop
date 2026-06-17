// Pure helpers for the workspace browser: parse the raw `.sk` object sidecars the
// read_sk_objects command returns, group them by kind, and derive the backlink graph.
// The desktop keeps a LOOSE mirror of @scidekick/science's object shape (like the
// NDJSON event types) so it tolerates schema drift across engine versions.

export interface SkEdge {
  rel: string;
  to: string;
  note?: string;
}

export interface SkObject {
  id: string;
  kind: string;
  slug?: string;
  title: string;
  body?: string;
  statement?: string;
  tags?: string[];
  links: SkEdge[];
  createdAt?: string;
  updatedAt?: string;
  // Kind-specific fields (provenance, imagePath, citeKey, …) are preserved here.
  [key: string]: unknown;
}

export interface SkBacklink {
  from: string;
  rel: string;
}

// Display order mirrors the engine's KIND_FOLDER ordering (core kinds, then ML overlay).
export const KIND_ORDER = [
  "question",
  "hypothesis",
  "protocol",
  "experiment",
  "dataset",
  "analysis",
  "figure",
  "claim",
  "manuscript",
  "paper",
  "note",
  "run",
  "sweep",
  "checkpoint",
  "eval",
  "leaderboard",
  "trace",
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Keep only values that look like a research object (id + kind + title), normalizing links. */
export function parseSkObjects(raw: unknown[]): SkObject[] {
  const out: SkObject[] = [];
  for (const value of raw) {
    if (!isRecord(value)) continue;
    if (typeof value.id !== "string" || typeof value.kind !== "string") continue;
    const links: SkEdge[] = Array.isArray(value.links)
      ? value.links
          .filter(isRecord)
          .filter((e) => typeof e.rel === "string" && typeof e.to === "string")
          .map((e) => ({ rel: e.rel as string, to: e.to as string, note: typeof e.note === "string" ? e.note : undefined }))
      : [];
    out.push({
      ...(value as Record<string, unknown>),
      id: value.id,
      kind: value.kind,
      title: typeof value.title === "string" ? value.title : value.id,
      links,
    } as SkObject);
  }
  return out;
}

export interface KindGroup {
  kind: string;
  objects: SkObject[];
}

/** Group objects by kind in KIND_ORDER; unknown kinds sort last alphabetically. Within a
 *  group, objects are ordered by updatedAt descending (most recently touched first). */
export function groupByKind(objects: SkObject[]): KindGroup[] {
  const byKind = new Map<string, SkObject[]>();
  for (const obj of objects) {
    if (!byKind.has(obj.kind)) byKind.set(obj.kind, []);
    byKind.get(obj.kind)?.push(obj);
  }
  const kinds = [...byKind.keys()].sort((a, b) => {
    const ia = KIND_ORDER.indexOf(a);
    const ib = KIND_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
  return kinds.map((kind) => ({
    kind,
    objects: (byKind.get(kind) ?? []).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")),
  }));
}

/** Objects that link TO `id`, with the relation they use. */
export function backlinksFor(objects: SkObject[], id: string): SkBacklink[] {
  const out: SkBacklink[] = [];
  for (const obj of objects) {
    for (const edge of obj.links) {
      if (edge.to === id) out.push({ from: obj.id, rel: edge.rel });
    }
  }
  return out;
}

/** A quick id -> title/kind index for resolving link targets to readable labels. */
export function objectIndex(objects: SkObject[]): Map<string, SkObject> {
  return new Map(objects.map((o) => [o.id, o]));
}
