import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CornerDownRight, Link2, RefreshCw } from "lucide-react";
import {
  type SkObject,
  backlinksFor,
  groupByKind,
  objectIndex,
  parseSkObjects,
} from "../lib/skObjects";
import { readSkObjects } from "../lib/tauri";
import type { Workspace } from "../types/agent";
import { Markdown } from "./Markdown";

// Workspace browser: lists the `.sk` research objects grouped by kind and shows a
// detail view (body + evidence links + backlinks) for the selected object. Reads the
// store directly via the read_sk_objects command; self-contained (fetches its own data).

export function ResearchPanel({ activeWorkspace }: { activeWorkspace: Workspace | null }) {
  const path = activeWorkspace?.path ?? null;
  const [objects, setObjects] = useState<SkObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      setObjects(parseSkObjects(await readSkObjects(path)));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [path]);

  // Reload (and clear selection) whenever the workspace changes.
  useEffect(() => {
    setSelectedId(null);
    void load();
  }, [load]);

  const index = useMemo(() => objectIndex(objects), [objects]);
  const groups = useMemo(() => groupByKind(objects), [objects]);
  const selected = selectedId ? (index.get(selectedId) ?? null) : null;

  if (!path) {
    return (
      <div className="panel-body">
        <p className="muted">Open a workspace to browse its research objects.</p>
      </div>
    );
  }

  return (
    <div className="panel-body research-panel">
      <div className="panel-action-row">
        <span>
          {objects.length} object{objects.length === 1 ? "" : "s"}
        </span>
        <button disabled={loading} onClick={() => void load()} type="button">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>
      {error ? <p className="muted research-error">{error}</p> : null}
      {selected ? (
        <ObjectDetail object={selected} objects={objects} index={index} onSelect={setSelectedId} />
      ) : (
        <ObjectList groups={groups} empty={!loading && objects.length === 0} onSelect={setSelectedId} />
      )}
    </div>
  );
}

function ObjectList({
  groups,
  empty,
  onSelect,
}: {
  groups: { kind: string; objects: SkObject[] }[];
  empty: boolean;
  onSelect: (id: string) => void;
}) {
  if (empty) {
    return <p className="muted">No research objects yet. They appear here as the agent creates them in .sk.</p>;
  }
  return (
    <div className="research-list">
      {groups.map((group) => (
        <div className="research-group" key={group.kind}>
          <div className="research-group-head">
            <span className={`kind-badge kind-${group.kind}`}>{group.kind}</span>
            <span className="research-count">{group.objects.length}</span>
          </div>
          {group.objects.map((obj) => (
            <button className="research-row" key={obj.id} type="button" onClick={() => onSelect(obj.id)}>
              <strong>{obj.title}</strong>
              <code>{obj.id}</code>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function ObjectDetail({
  object,
  objects,
  index,
  onSelect,
}: {
  object: SkObject;
  objects: SkObject[];
  index: Map<string, SkObject>;
  onSelect: (id: string | null) => void;
}) {
  const backlinks = useMemo(() => backlinksFor(objects, object.id), [objects, object.id]);
  const statement = typeof object.statement === "string" ? object.statement : null;
  const body = typeof object.body === "string" ? object.body : null;

  return (
    <div className="research-detail">
      <button className="research-back" type="button" onClick={() => onSelect(null)}>
        <ArrowLeft size={13} /> All objects
      </button>

      <div className="research-detail-head">
        <span className={`kind-badge kind-${object.kind}`}>{object.kind}</span>
        <h3>{object.title}</h3>
        <code>{object.id}</code>
      </div>

      {statement ? <blockquote className="research-statement">{statement}</blockquote> : null}
      {body ? <Markdown>{body}</Markdown> : null}

      <LinkSection title="Links" icon={<Link2 size={12} />} empty="No outgoing links.">
        {object.links.map((edge, i) => {
          const target = index.get(edge.to);
          return (
            <LinkRow
              key={`${edge.rel}-${edge.to}-${i}`}
              rel={edge.rel}
              label={target?.title ?? edge.to}
              targetKind={target?.kind}
              dangling={!target}
              onClick={target ? () => onSelect(edge.to) : undefined}
            />
          );
        })}
      </LinkSection>

      <LinkSection title="Referenced by" icon={<CornerDownRight size={12} />} empty="Nothing links here yet.">
        {backlinks.map((bl, i) => {
          const source = index.get(bl.from);
          return (
            <LinkRow
              key={`${bl.from}-${bl.rel}-${i}`}
              rel={bl.rel}
              label={source?.title ?? bl.from}
              targetKind={source?.kind}
              onClick={source ? () => onSelect(bl.from) : undefined}
              incoming
            />
          );
        })}
      </LinkSection>

      <div className="research-meta">
        {object.tags && object.tags.length ? <span>tags: {object.tags.join(", ")}</span> : null}
        {object.updatedAt ? <span>updated {object.updatedAt.slice(0, 19).replace("T", " ")}</span> : null}
      </div>
    </div>
  );
}

function LinkSection({
  title,
  icon,
  empty,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  empty: string;
  children: React.ReactNode[];
}) {
  const has = children.length > 0;
  return (
    <div className="research-links">
      <div className="research-links-head">
        {icon}
        <span>{title}</span>
      </div>
      {has ? children : <p className="muted">{empty}</p>}
    </div>
  );
}

function LinkRow({
  rel,
  label,
  targetKind,
  dangling,
  incoming,
  onClick,
}: {
  rel: string;
  label: string;
  targetKind?: string;
  dangling?: boolean;
  incoming?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className={`research-rel${incoming ? " incoming" : ""}`}>{rel}</span>
      {targetKind ? <span className={`kind-dot kind-${targetKind}`} /> : null}
      <span className={dangling ? "research-link-label dangling" : "research-link-label"}>{label}</span>
      {dangling ? <span className="research-dangling-tag">missing</span> : null}
    </>
  );
  return onClick ? (
    <button className="research-link-row" type="button" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="research-link-row static">{content}</div>
  );
}
