import type { Point } from "@swarmloom/core";
import type { PathSegment } from "./parse";

/**
 * A pen-tool anchor: an on-curve point with optional Bezier handles, as a designer would place it.
 * Coordinates are in the same space as the segments they came from.
 */
export interface PenAnchor {
  x: number;
  y: number;
  /** Control point of the curve arriving at this anchor. */
  in?: Point;
  /** Control point of the curve leaving this anchor. */
  out?: Point;
  /** First anchor of a subpath (the pen lifts before it). */
  start?: boolean;
  /** Last anchor of a closed subpath (the pen returns to the subpath start after it). */
  close?: boolean;
}

const SAME_POINT = 1e-6;

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < SAME_POINT && Math.abs(a.y - b.y) < SAME_POINT;
}

/**
 * Extracts pen anchors from normalised segments:
 * - every moveto starts a subpath anchor; line, curve and arc endpoints are anchors;
 * - cubic control points become the `out` handle of the previous anchor and the `in` handle of the
 *   endpoint; a quadratic control point serves as both;
 * - arcs keep their endpoint only (no fake Bezier handles);
 * - a closing segment that ends on the subpath start merges into the start anchor.
 *
 * When there are more than `max` anchors, an evenly spaced subset is returned without handles
 * (handles of skipped anchors would no longer describe the visible segments).
 */
export function extractAnchors(segments: readonly PathSegment[], max = 32): PenAnchor[] {
  const anchors: PenAnchor[] = [];
  let startIndex = -1;
  let last: PenAnchor | undefined;

  const push = (a: PenAnchor): void => {
    if (last && !a.start && samePoint(last, a)) {
      // Degenerate segment: keep one anchor but remember the incoming handle.
      if (a.in) last.in = a.in;
      return;
    }
    anchors.push(a);
    last = a;
  };

  for (const s of segments) {
    switch (s.type) {
      case "M": {
        // A moveto directly after another moveto replaces the lone anchor.
        if (last?.start && anchors.length - 1 === startIndex) anchors.pop();
        const a: PenAnchor = { x: s.x, y: s.y, start: true };
        anchors.push(a);
        last = a;
        startIndex = anchors.length - 1;
        break;
      }
      case "L":
      case "A":
        push({ x: s.x, y: s.y });
        break;
      case "C":
        if (last) last.out = { x: s.x1, y: s.y1 };
        push({ x: s.x, y: s.y, in: { x: s.x2, y: s.y2 } });
        break;
      case "Q":
        if (last) last.out = { x: s.x1, y: s.y1 };
        push({ x: s.x, y: s.y, in: { x: s.x1, y: s.y1 } });
        break;
      case "Z": {
        const first = anchors[startIndex];
        if (!first || !last) break;
        if (last !== first && samePoint(last, first)) {
          // The final anchor duplicates the start: fold its incoming handle into the start.
          anchors.pop();
          if (last.in) first.in = last.in;
          last = anchors[anchors.length - 1];
        }
        if (last) last.close = true;
        break;
      }
    }
  }
  return limitAnchors(anchors, max);
}

function limitAnchors(anchors: PenAnchor[], max: number): PenAnchor[] {
  if (anchors.length <= max) return anchors;
  if (max <= 0) return [];
  if (max === 1) return [{ x: anchors[0]?.x ?? 0, y: anchors[0]?.y ?? 0, start: true }];
  const out: PenAnchor[] = [];
  const step = (anchors.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    const src = anchors[Math.round(i * step)];
    if (!src) continue;
    const a: PenAnchor = { x: src.x, y: src.y };
    if (src.start || i === 0) a.start = true;
    out.push(a);
  }
  return out;
}
