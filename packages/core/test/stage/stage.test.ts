import { describe, expect, it } from "vitest";
import { Fade } from "../../src/stage/fade";
import { Geometry } from "../../src/stage/geometry";
import { LayerRegistry } from "../../src/stage/registry";
import { sanitizeHtml } from "../../src/stage/sanitize";
import { BRAND, resolveTheme } from "../../src/theme";
import type { Blueprint, Layer } from "../../src/types";

const bp = (extra: Partial<Blueprint> = {}): Blueprint => ({
  version: 1,
  source: { type: "test" },
  size: { w: 800, h: 600 },
  background: "#ffffff",
  layers: [],
  ...extra,
});

describe("resolveTheme", () => {
  it("uses the brand values by default and follows prefers-color-scheme for the chrome", () => {
    const t = resolveTheme("auto", bp(), true);
    expect(t.palette).toEqual([...BRAND.palette]);
    expect(t.accent).toBe(BRAND.accent);
    expect(t.select).toBe(BRAND.select);
    expect(t.chrome).toBe("dark");
    expect(t.scheme).toBe("light");
    expect(resolveTheme("light", bp(), true).chrome).toBe("light");
  });

  it("applies valid ThemeSpec overrides and ignores invalid ones", () => {
    const t = resolveTheme(
      { palette: ["#112233", "#zz", 42 as unknown as string], accent: "#12345", select: "#00ff00", chrome: "dark" },
      bp(),
      false,
    );
    expect(t.palette).toEqual(["#112233"]);
    expect(t.accent).toBe(BRAND.accent);
    expect(t.select).toBe("#00ff00");
    expect(t.chrome).toBe("dark");
  });

  it("derives the content scheme from Blueprint.scheme, else the background luminance", () => {
    expect(resolveTheme("auto", bp({ background: "#0b0b12" }), false).scheme).toBe("dark");
    expect(resolveTheme("auto", bp({ background: "#0b0b12", scheme: "light" }), false).scheme).toBe("light");
    expect(resolveTheme("auto", bp({ background: "transparent" }), true).scheme).toBe("dark");
  });
});

describe("Geometry", () => {
  it("inline: fits the world to the width and maps stage <-> client coordinates", () => {
    const g = new Geometry({ w: 1600, h: 4000 }, true);
    g.layout(800, 600);
    expect(g.scale).toBe(0.5);
    expect(g.extentH).toBe(2000);
    expect(g.scrollTopFor(10_000)).toBe(g.maxScrollTop);
    g.scrollTop = g.scrollTopFor(1000);
    expect(g.viewport({ x: 0, y: 0, w: 0, h: 0 })).toEqual({ x: 0, y: 1000, w: 1600, h: 1200 });
    const origin = { left: 30, top: 40 };
    const c = g.toClient({ x: 200, y: 1100 }, origin);
    expect(c).toEqual({ x: 130, y: 90 });
    expect(g.toStage(c, origin)).toEqual({ x: 200, y: 1100 });
  });

  it("inline: centres small content and caps the upscale", () => {
    const g = new Geometry({ w: 100, h: 100 }, true);
    g.layout(800, 600);
    expect(g.scale).toBe(2);
    expect(g.offsetX).toBe(300);
    expect(g.offsetY).toBe(200);
  });

  it("overlay: maps 1:1", () => {
    const g = new Geometry({ w: 1600, h: 4000 }, false);
    g.layout(800, 600);
    expect(g.scale).toBe(1);
    expect(g.worldTransform()).toBe("none");
  });
});

describe("LayerRegistry", () => {
  const box = (id: string, y: number, z?: number): Layer => ({
    id,
    kind: "box",
    box: { x: 0, y, w: 10, h: 10 },
    style: {},
    ...(z === undefined ? {} : { z }),
  });

  it("ranks paint order densely and indexes layers by vertical band", () => {
    const r = new LayerRegistry([
      box("a", 0, 5),
      box("b", 5000),
      box("c", 20, 5),
      { id: "g", kind: "guide", axis: "x", pos: 4, box: { x: 4, y: 0, w: 0, h: 100 } },
      { ...box("s", 30), snaps: ["g"] },
      box("a", 40),
    ]);
    // Order by (z ?? index, index): b(1) g(3) s(4) a(5) c(5) a-duplicate(5).
    expect(r.get("b")?.z).toBe(1);
    expect(r.get("a")?.z).toBe(4);
    expect(r.get("c")?.z).toBe(5);
    expect(r.domCount).toBe(4);
    expect(r.guides.map((g) => g.layer.id)).toEqual(["g"]);
    expect(r.dependents.get(r.guides[0] as never)?.map((s) => s.layer.id)).toEqual(["s"]);
    const hit: string[] = [];
    r.query(0, 100, 1, (s) => hit.push(s.layer.id));
    expect(hit.sort()).toEqual(["a", "c", "s"]);
  });
});

describe("Fade", () => {
  it("advances with engine time from its first step and resolves at the end", async () => {
    const f = new Fade(0);
    let done = false;
    void f.start(1, 100).then(() => {
      done = true;
    });
    expect(f.step(1000)).toBe(0);
    expect(f.step(1050)).toBeCloseTo(0.5, 5);
    expect(f.step(1100)).toBe(1);
    await Promise.resolve();
    expect(done).toBe(true);
    expect(f.active).toBe(false);
  });
});

describe("sanitizeHtml", () => {
  it("removes scripts, handlers and javascript: URLs", () => {
    const out = sanitizeHtml(
      document,
      '<p onclick="x()">a<script>bad()</script><a href="javascript:bad()">l</a><img src="x.png" onerror="bad()"></p>',
    );
    expect(out).not.toMatch(/script|onclick|onerror|javascript:/i);
    expect(out).toContain("x.png");
  });
});
