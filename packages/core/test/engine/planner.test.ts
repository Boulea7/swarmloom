import { describe, expect, it } from "vitest";
import { buildPlan, type Plan } from "../../src/engine/planner";
import { AVAILABLE, LOCKED, Schedule } from "../../src/engine/schedule";
import type { Layer } from "../../src/types";
import { blueprintOf, box, guide, samplePage, text } from "./fakes";

const plan = (layers: Layer[]): Plan => buildPlan(blueprintOf(layers), { estimate: () => 100 });
const ids = (p: Plan, tasks: ArrayLike<number>): string[] => Array.from(tasks, (i) => (p.layers[i] as Layer).id);
/** A viewport that sees the whole test world. */
const full = { x: 0, y: 0, w: 800, h: 10_000 };

/** Completes tasks in schedule order (always the best pick for an agent at the origin). */
function drain(s: Schedule): string[] {
  s.setBoundary(Number.POSITIVE_INFINITY);
  const out: string[] = [];
  for (let i = s.pick(0, 0, full); i >= 0; i = s.pick(0, 0, full)) {
    s.start(i);
    s.complete(i);
    out.push((s.plan.layers[i] as Layer).id);
  }
  return out;
}

describe("planner", () => {
  it("orders parents before children, masters (with subtree) before copies, guides before snapping text", () => {
    const p = buildPlan(samplePage(), { estimate: () => 100 });
    const order = ids(p, p.order);
    const before = (a: string, b: string): boolean => order.indexOf(a) < order.indexOf(b);
    expect(before("hero", "card1")).toBe(true);
    expect(before("hero", "title")).toBe(true);
    expect(before("g1", "title")).toBe(true);
    expect(before("card1", "card2")).toBe(true);
    expect(before("footer", "note")).toBe(true);
    expect(p.keys[p.layers.findIndex((l) => l.id === "card2")]).toBe("duplicate");
    // The schedule never releases a task before its dependencies are done.
    const built = drain(new Schedule(p));
    expect(built).toHaveLength(p.taskCount);
    expect(built.indexOf("card1")).toBeLessThan(built.indexOf("card2"));
    expect(built.indexOf("g1")).toBeLessThan(built.indexOf("title"));
  });

  it("waits for the whole master subtree before a duplicate", () => {
    const p = plan([
      box("m", 0, 0, 300, 100),
      text("m-label", 10, 10, "master", { parent: "m" }),
      box("copy", 0, 200, 300, 100, { master: "m" }),
    ]);
    const s = new Schedule(p);
    s.setBoundary(Number.POSITIVE_INFINITY);
    const at = (id: string): number => p.layers.findIndex((l) => l.id === id);
    s.start(at("m"));
    s.complete(at("m"));
    expect(s.status[at("copy")]).not.toBe(AVAILABLE);
    s.start(at("m-label"));
    s.complete(at("m-label"));
    expect(s.status[at("copy")]).toBe(AVAILABLE);
  });

  it("follows reading order (rows, then left to right) and lets priority override it", () => {
    const layers = [box("c", 400, 300), box("b", 400, 20), box("a", 20, 24), box("d", 20, 300)];
    expect(ids(plan(layers), plan(layers).order)).toEqual(["a", "b", "d", "c"]);
    const first = { ...layers[0], priority: -1 } as Layer;
    const p = plan([first, ...layers.slice(1)]);
    expect(ids(p, p.order)[0]).toBe("c");
  });

  it("unlocks viewport work first and ancestors as early as their first descendant", () => {
    const layers = [
      box("top", 0, 0),
      box("tall", 0, 1500, 800, 2000),
      box("inner", 0, 1600, 100, 40, { parent: "tall" }),
      box("deep", 0, 3000),
    ];
    const p = buildPlan(blueprintOf(layers, { w: 800, h: 3600 }), { estimate: () => 100 });
    const at = (id: string): number => p.layers.findIndex((l) => l.id === id);
    const s = new Schedule(p);
    s.setBoundary(900);
    expect(s.status[at("top")]).toBe(AVAILABLE);
    expect(s.status[at("tall")]).toBe(LOCKED);
    expect(s.nextLockedY()).toBe(1500);
    s.setBoundary(1550);
    expect(s.status[at("tall")]).toBe(AVAILABLE);
    expect(s.status[at("deep")]).toBe(LOCKED);
    // The boundary only moves down.
    s.setBoundary(100);
    expect(s.boundary).toBe(1550);
  });

  it("caps unlock lines at the world's bottom edge, so a tour that stops there still unlocks layers below it", () => {
    // World 1200 high, viewport 600: the camera stops at y 600, the boundary at 600 + 1.5 * 600.
    const p = plan([box("in", 20, 20), box("below", 20, 3000)]);
    const s = new Schedule(p);
    s.setBoundary(1500);
    expect(s.status[1]).toBe(AVAILABLE);
  });

  it("picks only work in sight (guides first); work above, below or clipped below waits for the camera", () => {
    const p = plan([
      box("above", 0, 0),
      box("in", 600, 700),
      guide("g", 700),
      box("below", 0, 1600),
      // Its box reaches into view, but the ancestor clip only shows the part below the fold.
      box("clipped", 0, 1100, 120, 200, { clip: { x: 0, y: 1250, w: 800, h: 400 } }),
      // Clipped away entirely: nobody will ever see it, so it needs no camera (revealed without a gesture).
      box("hidden", 0, 2400, 120, 200, { clip: { x: 0, y: 0, w: 800, h: 100 } }),
    ]);
    const s = new Schedule(p);
    s.setBoundary(Number.POSITIVE_INFINITY);
    const vp = { x: 0, y: 600, w: 800, h: 600 };
    const take = (view = vp): string | null => {
      const i = s.pick(0, 600, view);
      if (i < 0) return null;
      s.start(i);
      s.complete(i);
      return (p.layers[i] as Layer).id;
    };
    expect([take(), take(), take(), take()]).toEqual(["g", "in", "hidden", null]);
    expect(s.hasWorkInSight(vp)).toBe(false);
    expect(s.remainingInSight(vp)).toEqual({ estimate: 0, outside: true });
    expect(take({ ...vp, y: 1300 })).toBe("clipped");
    // The tour frontier skips unfinished work that ends above the given position.
    expect(s.frontier()).toBe(0);
    expect(s.frontier(200)).toBe(1600);
  });

  it("puts the tour frontier where unfinished work can be seen, not at the top of its box", () => {
    const p = plan([
      // The content of a scrolled container: its box starts far above the part its clip shows.
      box("scrolled", 0, 600, 400, 3400, { clip: { x: 0, y: 1500, w: 400, h: 300 } }),
      // Clipped away entirely: any agent takes it wherever the viewport is, so it holds no tour.
      box("hidden", 0, 300, 120, 200, { clip: { x: 0, y: 0, w: 800, h: 100 } }),
      box("below", 0, 2000),
    ]);
    const s = new Schedule(p);
    expect(s.frontier()).toBe(1500);
    // Once its seen part is scrolled past, the clipped layer no longer holds the tour.
    expect(s.frontier(1900)).toBe(2000);
  });

  it("reports dangling references, duplicate ids and cycles instead of throwing", () => {
    const p = plan([
      box("a", 0, 0, 100, 100, { parent: "b" }),
      box("b", 0, 200, 100, 100, { parent: "a" }),
      box("c", 0, 400, 100, 100, { parent: "ghost" }),
      box("c", 0, 500),
      { id: 3 } as unknown as Layer,
    ]);
    expect(p.taskCount).toBe(3);
    expect(p.diagnostics.join("\n")).toMatch(/cycle broken/);
    expect(p.diagnostics.join("\n")).toMatch(/missing layers/);
    expect(p.diagnostics.join("\n")).toMatch(/already used id/);
    expect(p.diagnostics.join("\n")).toMatch(/malformed/);
    expect(drain(new Schedule(p))).toHaveLength(3);
  });
});
