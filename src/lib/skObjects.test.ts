import { describe, expect, it } from "vitest";
import { backlinksFor, groupByKind, objectIndex, parseSkObjects } from "./skObjects";

const raw = [
  { id: "claim_1", kind: "claim", title: "X improves Y", statement: "X improves Y", updatedAt: "2026-06-10T10:00:00Z", links: [{ rel: "Supports", to: "fig_1" }, { rel: "DocumentedBy", to: "note_1" }] },
  { id: "fig_1", kind: "figure", title: "Result figure", updatedAt: "2026-06-10T09:00:00Z", links: [{ rel: "DerivedFrom", to: "ana_1" }] },
  { id: "ana_1", kind: "analysis", title: "Primary analysis", updatedAt: "2026-06-10T08:00:00Z", links: [] },
  { id: "note_1", kind: "note", title: "Decision note", updatedAt: "2026-06-11T08:00:00Z", links: [] },
  { id: "note_2", kind: "note", title: "Older note", updatedAt: "2026-06-09T08:00:00Z", links: [] },
  // sk.json manifest / junk — must be dropped (no id+kind).
  { schemaVersion: 1, createdAt: "x", coreLayout: true },
  "garbage",
  null,
];

describe("parseSkObjects", () => {
  it("keeps only id+kind records and normalizes links", () => {
    const objs = parseSkObjects(raw);
    expect(objs.map((o) => o.id).sort()).toEqual(["ana_1", "claim_1", "fig_1", "note_1", "note_2"]);
    const claim = objs.find((o) => o.id === "claim_1");
    expect(claim?.links).toEqual([{ rel: "Supports", to: "fig_1", note: undefined }, { rel: "DocumentedBy", to: "note_1", note: undefined }]);
  });

  it("drops malformed links and falls back title to id", () => {
    const objs = parseSkObjects([
      { id: "x_1", kind: "note", links: [{ rel: "Uses" }, { to: "y" }, "bad", { rel: "Uses", to: "ok_1" }] },
    ]);
    expect(objs[0].title).toBe("x_1");
    expect(objs[0].links).toEqual([{ rel: "Uses", to: "ok_1", note: undefined }]);
  });
});

describe("groupByKind", () => {
  it("orders groups by KIND_ORDER and objects by updatedAt desc", () => {
    const groups = groupByKind(parseSkObjects(raw));
    // KIND_ORDER puts analysis < figure < claim < note.
    expect(groups.map((g) => g.kind)).toEqual(["analysis", "figure", "claim", "note"]);
    const notes = groups.find((g) => g.kind === "note");
    expect(notes?.objects.map((o) => o.id)).toEqual(["note_1", "note_2"]); // newer first
  });
});

describe("backlinksFor", () => {
  it("finds objects that link to a target", () => {
    const objs = parseSkObjects(raw);
    expect(backlinksFor(objs, "fig_1")).toEqual([{ from: "claim_1", rel: "Supports" }]);
    expect(backlinksFor(objs, "ana_1")).toEqual([{ from: "fig_1", rel: "DerivedFrom" }]);
    expect(backlinksFor(objs, "claim_1")).toEqual([]);
  });
});

describe("objectIndex", () => {
  it("maps id to object", () => {
    const objs = parseSkObjects(raw);
    expect(objectIndex(objs).get("claim_1")?.title).toBe("X improves Y");
  });
});
