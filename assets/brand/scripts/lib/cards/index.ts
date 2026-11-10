import { motionOnly } from "../motion.ts";
import type { Palette } from "../palette.ts";
import { el, svgDoc } from "../svg.ts";
import { type Scheme, type Theme, themes } from "../theme.ts";
import { baseCss, type Kit, kitDefs, label, staticCss } from "./kit.ts";
import { docsScene, officeScene, pdfScene, vectorScene, webScene } from "./scenes-docs.ts";
import { codeScene, imageScene, modelScene, platformScene, videoScene } from "./scenes-media.ts";

/** Card artboard and the stage area scenes draw into. */
export const CARD = { width: 480, height: 300, radius: 16, stage: { x: 16, y: 16, w: 448, h: 196, r: 10 } } as const;

/** One feature card: id (file stem), bilingual caption, formats line and the scene painter. */
export interface CardSpec {
  id: string;
  zh: string;
  en: string;
  /** Short, right-aligned line of formats or targets. */
  formats: string;
  scene: (k: Kit) => string;
}

/** Feature cards in README order. */
export const CARDS: readonly CardSpec[] = [
  { id: "web", zh: "网页", en: "Web pages", formats: "URL · live DOM", scene: webScene },
  { id: "docs", zh: "文档", en: "Documents", formats: "MD · DOCX · DOC · TXT", scene: docsScene },
  { id: "pdf", zh: "PDF", en: "PDF, page by page", formats: "Text · images · vectors", scene: pdfScene },
  {
    id: "html-svg",
    zh: "HTML 与 SVG 动画",
    en: "HTML & SVG animation",
    formats: "HTML · CSS · SVG · SMIL",
    scene: vectorScene,
  },
  { id: "slides-sheets", zh: "幻灯片与表格", en: "Slides & sheets", formats: "PPTX · XLSX · CSV", scene: officeScene },
  { id: "code", zh: "代码", en: "Source code", formats: "TS · PY · GO · …", scene: codeScene },
  { id: "images", zh: "图片", en: "Images", formats: "PNG · JPG · WEBP · GIF", scene: imageScene },
  { id: "3d", zh: "3D 模型", en: "3D models", formats: "GLB · GLTF · OBJ · STL", scene: modelScene },
  { id: "platforms", zh: "全平台", en: "Every platform", formats: "Extensions · PWA · CLI", scene: platformScene },
  { id: "video", zh: "导出视频", en: "Video export", formats: "MP4 · WEBM · GIF", scene: videoScene },
];

/** Card chrome: outer surface, stage with the loom's warp texture, and the caption block. */
function frame(spec: CardSpec, t: Theme): { under: string; over: string } {
  const { width: w, height: h, radius: r, stage: s } = CARD;
  let warp = "";
  for (let x = s.x + 12; x < s.x + s.w; x += 12) warp += `M${x} ${s.y}V${s.y + s.h}`;
  const under = [
    el("clipPath", { id: "sc" }, el("rect", { x: s.x, y: s.y, width: s.w, height: s.h, rx: s.r })),
    el("rect", { width: w, height: h, rx: r, fill: t.surface }),
    el("rect", { x: s.x, y: s.y, width: s.w, height: s.h, rx: s.r, fill: t.bg }),
    el("path", { d: warp, stroke: t.faint, "clip-path": "url(#sc)" }),
  ].join("");
  const capY = s.y + s.h + 34;
  const over = [
    el("rect", {
      x: s.x + 0.5,
      y: s.y + 0.5,
      width: s.w - 1,
      height: s.h - 1,
      rx: s.r - 0.5,
      stroke: t.line,
      fill: "none",
    }),
    el("rect", { x: 0.5, y: 0.5, width: w - 1, height: h - 1, rx: r - 0.5, stroke: t.line, fill: "none" }),
    label(s.x + 8, capY, spec.zh, t.ink, 18, 600),
    label(s.x + 8, capY + 24, spec.en, t.muted, 13, 500),
    label(s.x + s.w - 8, capY + 24, spec.formats, t.muted, 11, 500, "end"),
  ].join("");
  return { under, over };
}

/** Renders one feature card for a scheme. Static first frame equals the resting design. */
export function cardSvg(spec: CardSpec, p: Palette, t: Theme): string {
  if (!/^[a-z0-9-]+$/.test(spec.id)) throw new Error(`invalid card id "${spec.id}"`);
  const k: Kit = { theme: t, palette: p, css: baseCss() };
  const { under, over } = frame(spec, t);
  const scene = spec.scene(k);
  const body = [kitDefs(k), under, el("g", { "clip-path": "url(#sc)" }, scene), over].join("");
  return svgDoc(body, {
    width: CARD.width,
    height: CARD.height,
    title: `${spec.zh} · ${spec.en}`,
    style: staticCss() + motionOnly(k.css),
  });
}

/** All cards in both schemes as files under cards/. */
export function cardAssets(p: Palette): { file: string; svg: string }[] {
  const th = themes(p);
  const schemes: Scheme[] = ["light", "dark"];
  return CARDS.flatMap((spec) =>
    schemes.map((s) => ({ file: `cards/${spec.id}-${s}.svg`, svg: cardSvg(spec, p, th[s]) })),
  );
}
