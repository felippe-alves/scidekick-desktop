import { describe, expect, it } from "vitest";
import { extractFigures, isRenderableImage } from "./figureView";

describe("extractFigures", () => {
  it("pulls figures from a marimo_run result", () => {
    const figs = extractFigures({
      content: [{ type: "text", text: "Ran nb.py: created analysis ana_1 with 2 figure(s)." }],
      details: {
        analysisId: "ana_1",
        figureIds: ["fig_1", "fig_2"],
        figures: [
          { id: "fig_1", title: "result.png", path: ".sk/runs-out/123/result.png" },
          { id: "fig_2", title: "loss.svg", path: ".sk/runs-out/123/loss.svg" },
        ],
      },
    });
    expect(figs).toHaveLength(2);
    expect(figs?.[0]).toEqual({ id: "fig_1", title: "result.png", path: ".sk/runs-out/123/result.png" });
  });

  it("returns null when there are no figures or it isn't a marimo result", () => {
    expect(extractFigures({ details: { analysisId: "ana_1", figureIds: [] } })).toBeNull();
    expect(extractFigures({ details: { figures: [] } })).toBeNull();
    expect(extractFigures({ details: { status: "supported" } })).toBeNull();
    expect(extractFigures(undefined)).toBeNull();
    expect(extractFigures("nope")).toBeNull();
  });

  it("skips malformed figure entries (missing path)", () => {
    const figs = extractFigures({
      details: {
        figures: [{ id: "fig_1", title: "ok", path: "a.png" }, { id: "fig_2", title: "broken" }, null, "x"],
      },
    });
    expect(figs).toHaveLength(1);
    expect(figs?.[0].path).toBe("a.png");
  });

  it("falls back to path for missing id/title", () => {
    const figs = extractFigures({ details: { figures: [{ path: "fig/x.png" }] } });
    expect(figs?.[0]).toEqual({ id: "fig/x.png", title: "fig/x.png", path: "fig/x.png" });
  });
});

describe("isRenderableImage", () => {
  it("accepts raster + svg, rejects pdf and unknowns", () => {
    expect(isRenderableImage("a.png")).toBe(true);
    expect(isRenderableImage("DIR/B.SVG")).toBe(true);
    expect(isRenderableImage("plot.jpeg")).toBe(true);
    expect(isRenderableImage("report.pdf")).toBe(false);
    expect(isRenderableImage("data.csv")).toBe(false);
    expect(isRenderableImage("noext")).toBe(false);
  });
});
