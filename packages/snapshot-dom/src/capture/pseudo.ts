import type { BoxLayer, ImageLayer, Rect, TextLayer } from "@swarmloom/core";
import { px } from "../util/css";
import { escapeAttr, escapeText, safeImageUrl } from "../util/html";
import { hasVisibleText, isFlexOrGrid } from "./inline";
import { pseudoOf } from "./pseudo-info";
import { type Capture, type Ctx, type ElInfo, emit } from "./state";
import {
  boxStyle,
  containerTextStyle,
  contentInsets,
  flexLayoutStyle,
  paintsBox,
  readBoxVisual,
  readTextProps,
} from "./styles";

/** Translation part (e, f) of a computed `matrix()` / `matrix3d()` transform. */
function translation(transform: string): [number, number] {
  const m = /^matrix(3d)?\(([^)]+)\)$/.exec(transform.trim());
  if (!m) return [0, 0];
  const v = (m[2] ?? "").split(",").map((s) => Number.parseFloat(s));
  const [e, f] = m[1] ? [v[12], v[13]] : [v[4], v[5]];
  return [Number.isFinite(e) ? (e as number) : 0, Number.isFinite(f) ? (f as number) : 0];
}

function zKey(ctx: Ctx, cs: CSSStyleDeclaration, index: number): number[] {
  const z = Number.parseInt(cs.zIndex, 10);
  const zi = Number.isFinite(z) ? z : 0;
  return [...ctx.stackKey, zi < 0 ? 0 : zi === 0 ? 3 : 4, zi, index];
}

/**
 * Emits an absolutely positioned ::before/::after of a positioned host (badges, ribbons,
 * decorative bars) as a box and/or text layer. The position is resolved from the computed insets
 * relative to the host's padding box; pseudo-elements whose position cannot be resolved are skipped.
 */
export function emitPositionedPseudo(
  cap: Capture,
  ctx: Ctx,
  host: ElInfo,
  which: "before" | "after",
  hostBox: Rect,
): void {
  if (host.position === "static" || ctx.linear) return;
  const p = pseudoOf(host, which);
  if (p?.position !== "absolute") return;
  const cs = p.cs;
  const w = cs.width;
  const h = cs.height;
  if (!w.endsWith("px") || !h.endsWith("px")) return;
  const borderBox = cs.boxSizing === "border-box";
  const [pt, pr, pb, pl] = contentInsets(cs);
  const bw = px(w) + (borderBox ? 0 : pl + pr);
  const bh = px(h) + (borderBox ? 0 : pt + pb);
  if (bw <= 0 || bh <= 0) return;
  const hcs = host.cs;
  const padX = hostBox.x + px(hcs.borderLeftWidth);
  const padY = hostBox.y + px(hcs.borderTopWidth);
  const padW = hostBox.w - px(hcs.borderLeftWidth) - px(hcs.borderRightWidth);
  const padH = hostBox.h - px(hcs.borderTopWidth) - px(hcs.borderBottomWidth);
  const left = cs.left.endsWith("px")
    ? px(cs.left)
    : cs.right.endsWith("px")
      ? padW - px(cs.right) - bw - px(cs.marginLeft) - px(cs.marginRight)
      : 0;
  const top = cs.top.endsWith("px")
    ? px(cs.top)
    : cs.bottom.endsWith("px")
      ? padH - px(cs.bottom) - bh - px(cs.marginTop) - px(cs.marginBottom)
      : 0;
  const [tx, ty] = translation(cs.transform);
  const box: Rect = { x: padX + left + px(cs.marginLeft) + tx, y: padY + top + px(cs.marginTop) + ty, w: bw, h: bh };
  const opacity = Number.parseFloat(cs.opacity);
  const pctx: Ctx = {
    ...ctx,
    clip: ctx.absClip,
    paintKey: zKey(ctx, cs, ++cap.treeIndex),
    opacity: ctx.opacity * (Number.isFinite(opacity) ? opacity : 1),
  };
  if (pctx.opacity <= 0.001 || cs.visibility !== "visible") return;
  const base = host.el.baseURI || cap.doc.baseURI;
  const v = readBoxVisual(cs);
  let parentId = ctx.parentId;
  if (paintsBox(v)) {
    const id = emit<BoxLayer>(cap, pctx, { kind: "box", box, style: boxStyle(cs, v, base) });
    if (id) parentId = id;
  }
  const textVisible = hasVisibleText(p.text);
  const image = p.image ? safeImageUrl(p.image, base) : null;
  if (!textVisible && !image) return;
  const content: Rect = { x: box.x + pl, y: box.y + pt, w: Math.max(1, bw - pl - pr), h: Math.max(1, bh - pt - pb) };
  if (image && !textVisible) {
    emit<ImageLayer>(cap, { ...pctx, parentId }, { kind: "image", box: content, src: image, fit: "contain" });
    return;
  }
  const style = containerTextStyle(readTextProps(cs, cap.families));
  if (isFlexOrGrid(p.display)) flexLayoutStyle(cs, style);
  style["white-space"] = style["white-space"] ?? "nowrap";
  const img = image ? `<img src="${escapeAttr(image)}" alt="" style="vertical-align:middle">` : "";
  const draft: Omit<TextLayer, "id"> = {
    kind: "text",
    box: content,
    html: img + escapeText(p.text),
    text: p.text.trim(),
    style,
    fontSize: Math.round(px(cs.fontSize, 16) * 100) / 100,
  };
  emit<TextLayer>(cap, { ...pctx, parentId }, draft);
}
