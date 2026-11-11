/**
 * Mind map readers: XMind (.xmind zip with content.json for XMind Zen/2020+, content.xml for
 * XMind 8) and FreeMind/Freeplane (.mm XML). All produce the same small tree model.
 */

import { unzipSync } from "fflate";

/** Thrown for inputs that are not a readable mind map. */
export class MindmapError extends Error {
  override name = "MindmapError";
}

export interface MindNode {
  id: string;
  title: string;
  children: MindNode[];
  /** Plain-text note. */
  note?: string;
  /** Hyperlink (http, https or mailto only). */
  link?: string;
  /** Side hint for first-level branches (FreeMind POSITION). */
  side?: "left" | "right";
  /** Collapsed in the source application (children are still shown). */
  folded?: boolean;
}

export type MindmapFormat = "xmind-zen" | "xmind-8" | "freemind";

export interface MindMap {
  format: MindmapFormat;
  /** Sheet or map title. */
  title: string;
  root: MindNode;
  /** Nodes dropped because of limits, plus floating topics and extra sheets that are not drawn. */
  dropped: number;
  /** Human-readable notes about what was simplified. */
  notes: string[];
}

export interface ParseOptions {
  /** Most nodes kept. Default 1500. */
  maxNodes?: number;
  /** Deepest level kept (root is 0). Default 24. */
  maxDepth?: number;
  /** Largest uncompressed content part read from an .xmind archive, bytes. Default 20 MiB. */
  maxPartBytes?: number;
}

const MAX_TITLE = 400;

function cleanTitle(v: unknown): string {
  if (typeof v !== "string") return "";
  let out = "";
  for (const ch of v.replace(/\r\n?/g, "\n")) {
    const c = ch.charCodeAt(0);
    out += (c < 0x20 && c !== 10) || c === 0x7f ? " " : ch;
  }
  return out.trim().slice(0, MAX_TITLE);
}

function safeLink(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return /^(?:https?:|mailto:)/i.test(s) && s.length <= 2048 ? s : undefined;
}

class Budget {
  nodes = 0;
  dropped = 0;
  ids = new Set<string>();
  constructor(
    readonly maxNodes: number,
    readonly maxDepth: number,
  ) {}
  /** Unique id derived from the source id (or a counter). */
  id(raw: unknown): string {
    let base = typeof raw === "string" && /^[\w.:-]{1,64}$/.test(raw) ? raw : `n${this.nodes}`;
    while (this.ids.has(base)) base = `${base}_`;
    this.ids.add(base);
    return base;
  }
}

function countTree(n: unknown, childrenOf: (n: unknown) => unknown[], depth = 0): number {
  if (depth > 64) return 0;
  let total = 1;
  for (const c of childrenOf(n)) total += countTree(c, childrenOf, depth + 1);
  return total;
}

/* ------------------------------------------------------------------ */
/* XMind Zen: content.json                                             */
/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function zenChildren(t: unknown): unknown[] {
  if (!isObj(t) || !isObj(t.children)) return [];
  const attached = t.children.attached;
  return Array.isArray(attached) ? attached : [];
}

function zenNote(t: Json): string | undefined {
  const notes = t.notes;
  if (!isObj(notes)) return undefined;
  const plain = isObj(notes.plain) ? notes.plain.content : undefined;
  const text = cleanTitle(typeof plain === "string" ? plain : "");
  return text || undefined;
}

function zenTopic(t: unknown, depth: number, budget: Budget): MindNode | null {
  if (!isObj(t)) return null;
  if (budget.nodes >= budget.maxNodes || depth > budget.maxDepth) {
    budget.dropped += countTree(t, zenChildren);
    return null;
  }
  budget.nodes++;
  const node: MindNode = { id: budget.id(t.id), title: cleanTitle(t.title), children: [] };
  const note = zenNote(t);
  if (note) node.note = note;
  const link = safeLink(t.href);
  if (link) node.link = link;
  if (t.branch === "folded") node.folded = true;
  for (const c of zenChildren(t)) {
    const child = zenTopic(c, depth + 1, budget);
    if (child) node.children.push(child);
  }
  if (isObj(t.children)) {
    for (const key of ["detached", "summary", "callout"]) {
      const extra = t.children[key];
      if (Array.isArray(extra)) budget.dropped += extra.reduce((n: number, e) => n + countTree(e, zenChildren), 0);
    }
  }
  return node;
}

function parseZen(json: string, opts: Required<ParseOptions>): MindMap {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    throw new MindmapError("xmind: content.json is not valid JSON");
  }
  const sheets = Array.isArray(doc) ? doc : isObj(doc) ? [doc] : [];
  const sheet = sheets.find((s) => isObj(s) && isObj(s.rootTopic)) as Json | undefined;
  if (!sheet) throw new MindmapError("xmind: no sheet with a root topic");
  const budget = new Budget(opts.maxNodes, opts.maxDepth);
  const root = zenTopic(sheet.rootTopic, 0, budget) as MindNode;
  const notes: string[] = [];
  let dropped = budget.dropped;
  if (sheets.length > 1) {
    notes.push(`Only the first of ${sheets.length} sheets is shown.`);
    dropped += sheets.length - 1;
  }
  if (budget.dropped > 0) notes.push(`${budget.dropped} topics were not drawn (limits, floating topics, summaries).`);
  return { format: "xmind-zen", title: cleanTitle(sheet.title) || root.title, root, dropped, notes };
}

/* ------------------------------------------------------------------ */
/* XML helpers (XMind 8 and FreeMind)                                  */
/* ------------------------------------------------------------------ */

function parseXml(text: string, what: string): Document {
  if (/<!DOCTYPE[^>]*\[/i.test(text) || /<!ENTITY/i.test(text))
    throw new MindmapError(`${what}: DTDs and entities are not accepted`);
  const Parser = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (!Parser) throw new MindmapError(`${what}: XML parsing needs DOMParser`);
  const doc = new Parser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0 || !doc.documentElement)
    throw new MindmapError(`${what}: the XML is not well-formed`);
  return doc;
}

const kids = (el: Element, name: string): Element[] => Array.from(el.children).filter((c) => c.localName === name);

/* ------------------------------------------------------------------ */
/* XMind 8: content.xml                                                */
/* ------------------------------------------------------------------ */

function x8Children(t: unknown): Element[] {
  const el = t as Element;
  const out: Element[] = [];
  for (const children of kids(el, "children")) {
    for (const topics of kids(children, "topics")) {
      if ((topics.getAttribute("type") ?? "attached") === "attached") out.push(...kids(topics, "topic"));
    }
  }
  return out;
}

function x8Topic(el: Element, depth: number, budget: Budget): MindNode | null {
  if (budget.nodes >= budget.maxNodes || depth > budget.maxDepth) {
    budget.dropped += countTree(el, x8Children);
    return null;
  }
  budget.nodes++;
  const title = kids(el, "title")[0]?.textContent ?? "";
  const node: MindNode = { id: budget.id(el.getAttribute("id")), title: cleanTitle(title), children: [] };
  const plain = kids(el, "notes")[0] ? kids(kids(el, "notes")[0] as Element, "plain")[0]?.textContent : undefined;
  const note = cleanTitle(plain ?? "");
  if (note) node.note = note;
  const link = safeLink(el.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? el.getAttribute("xlink:href"));
  if (link) node.link = link;
  if (el.getAttribute("branch") === "folded") node.folded = true;
  for (const c of x8Children(el)) {
    const child = x8Topic(c, depth + 1, budget);
    if (child) node.children.push(child);
  }
  for (const children of kids(el, "children")) {
    for (const topics of kids(children, "topics")) {
      if ((topics.getAttribute("type") ?? "attached") !== "attached") {
        for (const t of kids(topics, "topic")) budget.dropped += countTree(t, x8Children);
      }
    }
  }
  return node;
}

function parseXmind8(xml: string, opts: Required<ParseOptions>): MindMap {
  const doc = parseXml(xml, "xmind");
  const sheets = Array.from(doc.documentElement.children).filter((c) => c.localName === "sheet");
  const sheet = sheets.find((s) => kids(s, "topic").length > 0);
  if (!sheet) throw new MindmapError("xmind: no sheet with a root topic");
  const budget = new Budget(opts.maxNodes, opts.maxDepth);
  const root = x8Topic(kids(sheet, "topic")[0] as Element, 0, budget) as MindNode;
  const notes: string[] = [];
  let dropped = budget.dropped;
  if (sheets.length > 1) {
    notes.push(`Only the first of ${sheets.length} sheets is shown.`);
    dropped += sheets.length - 1;
  }
  if (budget.dropped > 0) notes.push(`${budget.dropped} topics were not drawn (limits or floating topics).`);
  const title = cleanTitle(kids(sheet, "title")[0]?.textContent ?? "");
  return { format: "xmind-8", title: title || root.title, root, dropped, notes };
}

/* ------------------------------------------------------------------ */
/* FreeMind / Freeplane: .mm                                           */
/* ------------------------------------------------------------------ */

function mmChildren(n: unknown): Element[] {
  return kids(n as Element, "node");
}

function mmRich(el: Element, type: string): string {
  for (const rc of kids(el, "richcontent")) {
    if ((rc.getAttribute("TYPE") ?? "").toUpperCase() === type) {
      // Block elements end lines; textContent alone would glue paragraphs together.
      const parts: string[] = [];
      const walk = (n: Node): void => {
        if (n.nodeType === 3) parts.push(n.nodeValue ?? "");
        else if (n.nodeType === 1) {
          const name = (n as Element).localName.toLowerCase();
          if (name === "head" || name === "style" || name === "script") return;
          if (name === "br") parts.push("\n");
          for (const c of Array.from(n.childNodes)) walk(c);
          if (name === "p" || name === "div" || name === "li") parts.push("\n");
        }
      };
      walk(rc);
      return parts
        .join("")
        .replace(/[ \t]+/g, " ")
        .replace(/ ?\n ?/g, "\n")
        .replace(/\n{2,}/g, "\n")
        .trim();
    }
  }
  return "";
}

function mmNode(el: Element, depth: number, budget: Budget): MindNode | null {
  if (budget.nodes >= budget.maxNodes || depth > budget.maxDepth) {
    budget.dropped += countTree(el, mmChildren);
    return null;
  }
  budget.nodes++;
  const title = el.getAttribute("TEXT") ?? mmRich(el, "NODE");
  const node: MindNode = { id: budget.id(el.getAttribute("ID")), title: cleanTitle(title), children: [] };
  const note = cleanTitle(mmRich(el, "NOTE"));
  if (note) node.note = note;
  const link = safeLink(el.getAttribute("LINK"));
  if (link) node.link = link;
  const pos = el.getAttribute("POSITION");
  if (pos === "left" || pos === "right") node.side = pos;
  if (el.getAttribute("FOLDED") === "true") node.folded = true;
  for (const c of mmChildren(el)) {
    const child = mmNode(c, depth + 1, budget);
    if (child) node.children.push(child);
  }
  return node;
}

function parseFreemind(xml: string, opts: Required<ParseOptions>): MindMap {
  const doc = parseXml(xml, "freemind");
  const map = doc.documentElement;
  if (map.localName !== "map") throw new MindmapError("freemind: the root element is not <map>");
  const rootEl = kids(map, "node")[0];
  if (!rootEl) throw new MindmapError("freemind: the map has no root node");
  const budget = new Budget(opts.maxNodes, opts.maxDepth);
  const root = mmNode(rootEl, 0, budget) as MindNode;
  const notes = budget.dropped > 0 ? [`${budget.dropped} nodes were not drawn (limits).`] : [];
  return { format: "freemind", title: root.title, root, dropped: budget.dropped, notes };
}

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

function withDefaults(o: ParseOptions): Required<ParseOptions> {
  return {
    maxNodes: Math.max(1, o.maxNodes ?? 1500),
    maxDepth: Math.max(1, o.maxDepth ?? 24),
    maxPartBytes: Math.max(1024, o.maxPartBytes ?? 20 * 1024 * 1024),
  };
}

const isZip = (b: Uint8Array): boolean =>
  b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** Reads an .xmind archive (Zen content.json preferred, XMind 8 content.xml otherwise). */
export function parseXmind(bytes: Uint8Array, options: ParseOptions = {}): MindMap {
  const opts = withDefaults(options);
  if (!isZip(bytes)) throw new MindmapError("xmind: not a zip archive");
  let parts: Record<string, Uint8Array>;
  let tooLarge = false;
  try {
    parts = unzipSync(bytes, {
      filter: (f) => {
        if (f.name !== "content.json" && f.name !== "content.xml") return false;
        if (f.originalSize > opts.maxPartBytes) {
          tooLarge = true;
          return false;
        }
        return true;
      },
    });
  } catch (e) {
    throw new MindmapError(`xmind: the archive cannot be read (${(e as Error).message})`);
  }
  if (tooLarge) throw new MindmapError(`xmind: the content part is larger than ${opts.maxPartBytes} bytes`);
  const decode = (b: Uint8Array): string => new TextDecoder("utf-8").decode(b).replace(/^\uFEFF/, "");
  const json = parts["content.json"];
  if (json) return parseZen(decode(json), opts);
  const xml = parts["content.xml"];
  if (xml) return parseXmind8(decode(xml), opts);
  throw new MindmapError("xmind: the archive has neither content.json nor content.xml");
}

/** Reads a FreeMind or Freeplane .mm document. */
export function parseFreemindText(text: string, options: ParseOptions = {}): MindMap {
  return parseFreemind(text.replace(/^\uFEFF/, ""), withDefaults(options));
}

/** Reads any supported mind map from bytes (zip -> XMind, `<map` -> FreeMind). */
export function parseMindmap(bytes: Uint8Array, options: ParseOptions = {}): MindMap {
  if (isZip(bytes)) return parseXmind(bytes, options);
  const text = new TextDecoder("utf-8").decode(bytes);
  if (looksLikeFreemind(text)) return parseFreemindText(text, options);
  throw new MindmapError("mindmap: expected an .xmind archive or a FreeMind/Freeplane .mm document");
}

/** A FreeMind/Freeplane document: `<map` as the first element (after an XML declaration and comments). */
export function looksLikeFreemind(head: string): boolean {
  return /^\uFEFF?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<map[\s>]/.test(head) && /<node[\s>]/.test(head);
}

/** An .xmind archive: a zip whose first entries include content.json or content.xml (and no ODF mimetype). */
export function looksLikeXmind(head: Uint8Array): boolean {
  if (!isZip(head)) return false;
  const text = new TextDecoder("latin1").decode(head.subarray(0, 64 * 1024));
  return /content\.(?:json|xml)/.test(text) && firstEntryName(head) !== "mimetype";
}

/** Name of the first local file entry of a zip (ODF packages start with "mimetype"). */
function firstEntryName(head: Uint8Array): string {
  if (head.length < 30) return "";
  const len = (head[26] ?? 0) | ((head[27] ?? 0) << 8);
  return new TextDecoder("latin1").decode(head.subarray(30, 30 + Math.min(len, 64)));
}
