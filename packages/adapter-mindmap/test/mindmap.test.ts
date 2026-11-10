import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  buildMindmapBlueprint,
  connectorPath,
  createMindmapAdapter,
  layoutMindmap,
  looksLikeFreemind,
  looksLikeXmind,
  type MeasureText,
  type MindMap,
  MindmapError,
  mindmapAdapter,
  parseFreemindText,
  parseMindmap,
  parseXmind,
} from "../src/index";

const ctx = { document, width: 1000, theme: "light" as const };
/** Deterministic measurement: 0.55 em per character. */
const measure: MeasureText = (text, font) => text.length * 0.55 * Number(/([\d.]+)px/.exec(font)?.[1] ?? 14);

const zen = (content: unknown, extra: Record<string, string> = {}): Uint8Array =>
  zipSync({
    "content.json": strToU8(JSON.stringify(content)),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, strToU8(v)])),
  });

const ZEN_SHEETS = [
  {
    id: "s1",
    title: "Sheet one",
    rootTopic: {
      id: "root",
      title: "Centre",
      children: {
        attached: [
          {
            id: "a",
            title: "Alpha",
            notes: { plain: { content: "note a" } },
            children: { attached: [{ id: "a1", title: "A one" }] },
          },
          { id: "b", title: "Beta", href: "javascript:alert(1)" },
          { id: "c", title: "Gamma", href: "https://example.org", branch: "folded" },
        ],
        detached: [{ id: "float", title: "Floating" }],
      },
    },
  },
  { id: "s2", title: "Sheet two", rootTopic: { id: "r2", title: "Other" } },
];

const XMIND8 = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0" xmlns:xlink="http://www.w3.org/1999/xlink" version="2.0">
  <sheet id="s1"><topic id="root"><title>Old school</title>
    <children><topics type="attached">
      <topic id="x" xlink:href="https://example.org/x"><title>Ex</title><notes><plain>plain note</plain></notes>
        <children><topics type="attached"><topic id="x1"><title>Ex one</title></topic></topics></children>
      </topic>
      <topic id="y"><title>Why</title></topic>
    </topics><topics type="detached"><topic id="d"><title>Detached</title></topic></topics></children>
  </topic><title>Sheet 8</title></sheet>
</xmap-content>`;

const MM = `<?xml version="1.0"?>
<!-- comment -->
<map version="1.0.1">
<node TEXT="Root" ID="ID_1">
  <node TEXT="Left one" POSITION="left" ID="ID_2" FOLDED="true"><node TEXT="Deep" ID="ID_3"/></node>
  <node TEXT="Right one" POSITION="right" ID="ID_4" LINK="https://example.org"/>
  <node ID="ID_5" POSITION="right"><richcontent TYPE="NODE"><html><body><p>Two</p><p>lines</p></body></html></richcontent>
    <richcontent TYPE="NOTE"><html><body><p>A note</p></body></html></richcontent></node>
</node>
</map>`;

describe("parsers", () => {
  it("reads XMind Zen content.json: notes, safe links, folded branches, floating topics, extra sheets", () => {
    const map = parseXmind(zen(ZEN_SHEETS));
    expect(map.format).toBe("xmind-zen");
    expect(map.title).toBe("Sheet one");
    expect(map.root.children.map((c) => c.title)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(map.root.children[0]).toMatchObject({ note: "note a", children: [{ title: "A one" }] });
    expect(map.root.children[1]?.link).toBeUndefined();
    expect(map.root.children[2]).toMatchObject({ link: "https://example.org", folded: true });
    expect(map.dropped).toBe(2);
    expect(map.notes.join(" ")).toMatch(/first of 2 sheets/);
  });

  it("prefers content.json over the XMind Zen content.xml stub", () => {
    const map = parseXmind(zen(ZEN_SHEETS, { "content.xml": "<xmap-content><warning/></xmap-content>" }));
    expect(map.format).toBe("xmind-zen");
  });

  it("reads XMind 8 content.xml", () => {
    const map = parseXmind(zipSync({ "content.xml": strToU8(XMIND8), "meta.xml": strToU8("<meta/>") }));
    expect(map.format).toBe("xmind-8");
    expect(map.title).toBe("Sheet 8");
    expect(map.root.title).toBe("Old school");
    expect(map.root.children.map((c) => c.title)).toEqual(["Ex", "Why"]);
    expect(map.root.children[0]).toMatchObject({ note: "plain note", link: "https://example.org/x" });
    expect(map.dropped).toBe(1);
  });

  it("reads FreeMind/Freeplane: side hints, folded nodes, rich text and notes", () => {
    const map = parseFreemindText(MM);
    expect(map.format).toBe("freemind");
    const [left, right, rich] = map.root.children;
    expect(left).toMatchObject({ title: "Left one", side: "left", folded: true });
    expect(right).toMatchObject({ side: "right", link: "https://example.org" });
    expect(rich).toMatchObject({ title: "Two\nlines", note: "A note" });
  });

  it("applies node and depth limits", () => {
    const deep = {
      id: "r",
      title: "r",
      children: { attached: [{ id: "1", title: "1", children: { attached: [{ id: "2", title: "2" }] } }] },
    };
    expect(parseXmind(zen([{ rootTopic: deep }]), { maxDepth: 1 }).dropped).toBe(1);
    expect(parseXmind(zen([{ rootTopic: deep }]), { maxNodes: 1 }).dropped).toBe(2);
  });

  const rejects: [string, () => unknown, RegExp][] = [
    ["not a zip", () => parseXmind(strToU8("hello")), /not a zip/],
    [
      "zip without content",
      () => parseXmind(zipSync({ "x.txt": strToU8("x") })),
      /neither content.json nor content.xml/,
    ],
    ["bad JSON", () => parseXmind(zipSync({ "content.json": strToU8("{nope") })), /not valid JSON/],
    ["no root topic", () => parseXmind(zen([{ title: "empty" }])), /no sheet with a root topic/],
    ["broken XML", () => parseFreemindText("<map><node TEXT='a'></map>"), /not well-formed/],
    ["entities", () => parseFreemindText('<!DOCTYPE map [<!ENTITY x "y">]><map><node TEXT="&x;"/></map>'), /entities/],
    ["wrong root", () => parseFreemindText("<svg><node/></svg>"), /not <map>/],
    ["empty map", () => parseFreemindText("<map></map>"), /no root node/],
    ["unknown bytes", () => parseMindmap(strToU8("just text")), /expected an .xmind archive/],
  ];
  it.each(rejects)("rejects: %s", (_name, run, message) => {
    expect(run).toThrow(MindmapError);
    expect(run).toThrow(message);
  });

  it("sniffs XMind archives and FreeMind documents", () => {
    expect(looksLikeXmind(zen(ZEN_SHEETS))).toBe(true);
    expect(
      looksLikeXmind(
        zipSync(
          { mimetype: strToU8("application/vnd.oasis.opendocument.text"), "content.xml": strToU8("<x/>") },
          { level: 0 },
        ),
      ),
    ).toBe(false);
    expect(looksLikeFreemind(MM)).toBe(true);
    expect(looksLikeFreemind("<html><body>map</body></html>")).toBe(false);
    expect(mindmapAdapter.sniff?.(strToU8(MM))).toBe(true);
  });
});

describe("layout", () => {
  const map: MindMap = parseXmind(zen(ZEN_SHEETS));

  it("balances first-level branches and grows outward", () => {
    const layout = layoutMindmap(map, 2000, measure);
    const root = layout.nodes[0];
    expect(root?.depth).toBe(0);
    const firsts = layout.nodes.filter((n) => n.depth === 1);
    expect(new Set(firsts.map((n) => n.side))).toEqual(new Set([1, -1]));
    for (const n of layout.nodes) {
      if (!n.parent || n.depth < 2) continue;
      if (n.side === 1) expect(n.x).toBeGreaterThan(n.parent.x + n.parent.w);
      else expect(n.x + n.w).toBeLessThan(n.parent.x);
    }
    // No two topics overlap.
    for (const a of layout.nodes)
      for (const b of layout.nodes) {
        if (a === b) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.node.title} / ${b.node.title}`).toBe(false);
      }
  });

  it("is deterministic and respects FreeMind side hints", () => {
    const a = layoutMindmap(map, 2000, measure);
    const b = layoutMindmap(map, 2000, measure);
    expect(a.nodes.map((n) => [n.x, n.y, n.w, n.h])).toEqual(b.nodes.map((n) => [n.x, n.y, n.w, n.h]));
    const mm = layoutMindmap(parseFreemindText(MM), 2000, measure);
    expect(mm.nodes.find((n) => n.node.title === "Left one")?.side).toBe(-1);
    expect(mm.nodes.find((n) => n.node.title === "Right one")?.side).toBe(1);
  });

  it("shrinks to fit narrow widths", () => {
    const wide = layoutMindmap(map, 5000, measure);
    const narrow = layoutMindmap(map, wide.width * 0.6, measure);
    expect(narrow.width).toBeLessThanOrEqual(Math.ceil(wide.width * 0.6) + 1);
  });

  it("draws connectors from the facing edges", () => {
    const layout = layoutMindmap(map, 2000, measure);
    const child = layout.nodes.find((n) => n.depth === 1 && n.side === 1);
    const d = connectorPath(child?.parent as never, child as never, 0, 0);
    expect(d).toMatch(/^M [\d.]+ [\d.]+ C /);
  });
});

describe("mindmapAdapter", () => {
  it("builds root, branch and leaf layers in tree order", async () => {
    const { blueprint, plugins } = await mindmapAdapter.load({ bytes: zen(ZEN_SHEETS), name: "m.xmind" }, ctx);
    expect(plugins).toBeUndefined();
    expect(blueprint.source).toMatchObject({ type: "mindmap", name: "m.xmind", title: "Sheet one" });
    const byId = new Map(blueprint.layers.map((l) => [l.id, l]));
    expect(byId.get("mm-root-box")?.parent).toBeUndefined();
    expect(byId.get("mm-a-edge")?.parent).toBe("mm-root-text");
    expect(byId.get("mm-a-box")?.parent).toBe("mm-a-edge");
    expect(byId.get("mm-a1-edge")?.parent).toBe("mm-a-text");
    const edge = byId.get("mm-a-edge");
    expect(edge?.kind === "path" && edge.reveal).toBe("pen");
    expect(blueprint.truncated?.dropped).toBe(2);
    for (const l of blueprint.layers) {
      expect(l.box.x).toBeGreaterThanOrEqual(0);
      expect(l.box.x + l.box.w).toBeLessThanOrEqual(blueprint.size.w + 0.5);
      expect(l.box.y + l.box.h).toBeLessThanOrEqual(blueprint.size.h + 0.5);
    }
  });

  it("loads .mm text and rejects bad input", async () => {
    const { blueprint } = await mindmapAdapter.load({ text: MM }, { ...ctx, theme: "dark" });
    expect(blueprint.background).toBe("#0B0B12");
    expect(blueprint.layers.filter((l) => l.kind === "text").map((l) => (l.kind === "text" ? l.text : ""))).toContain(
      "Two\nlines",
    );
    await expect(mindmapAdapter.load({ text: "# not a map" }, ctx)).rejects.toThrow(MindmapError);
    await expect(mindmapAdapter.load({}, ctx)).rejects.toThrow(/bytes, text or a URL/);
    await expect(createMindmapAdapter({ maxBytes: 10 }).load({ text: MM }, ctx)).rejects.toThrow(/too large/);
  });

  it("keeps whole levels when the layer budget is hit", () => {
    const map = parseXmind(zen(ZEN_SHEETS));
    const layout = layoutMindmap(map, 2000, measure);
    const bp = buildMindmapBlueprint(map, layout, { theme: "light", width: 1000, maxLayers: 7 });
    expect(bp.layers.map((l) => l.id)).toEqual(["mm-root-box", "mm-root-text", "mm-a-edge", "mm-a-box", "mm-a-text"]);
    expect(bp.truncated?.dropped).toBe(2 + 3);
  });
});
