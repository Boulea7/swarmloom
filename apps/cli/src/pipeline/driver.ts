import type { SoundEvent } from "@swarmloom/core";
import type { BrowserContext, CDPSession, Page } from "playwright-core";
import { type PageLog, watchPage } from "../browser/launch";
import { briefMessage, CliError, RenderError } from "../errors";
import type { CliIo } from "../io";
import { guard } from "../util/async";
import type { FrameSource } from "./frames";
import {
  asRenderInfo,
  asSoundEvents,
  asStepResult,
  type RenderApi,
  type RenderInfo,
  type RenderInit,
  type StepResult,
} from "./protocol";

const PAGE_READY_MS = 60_000;
const INIT_MS = 180_000;
const STEP_MS = 60_000;
const AUDIO_MS = 180_000;
/** Most text-bearing elements asked for their fonts (each is one CDP round trip). */
const MAX_FONT_NODES = 2000;

type SwarmWindow = { __swarmloom: RenderApi };

/** A font the browser used to draw the page's text (CSS.getPlatformFontsForNode). */
export interface PlatformFont {
  family: string;
  postScriptName: string;
  /** Loaded with @font-face rather than installed on the system. */
  custom: boolean;
  glyphs: number;
}

interface DomNode {
  nodeId: number;
  nodeType: number;
  nodeValue?: string;
  children?: DomNode[];
  shadowRoots?: DomNode[];
  contentDocument?: DomNode;
}

export interface DriverOptions {
  /** URL of the render page's index.html. */
  url: string;
  width: number;
  height: number;
  /** deviceScaleFactor of the captured frames. */
  scale: number;
  imageType: "jpeg" | "png";
  io: CliIo;
  verbose: boolean;
  signal?: AbortSignal;
}

/**
 * Drives the @swarmloom/export render page (`window.__swarmloom`) in one browser page and captures
 * its frames over CDP. Every call is bounded by a timeout and the abort signal; page failures come
 * back as RenderError with the page's recent console errors attached.
 */
export class RenderPageDriver implements FrameSource {
  private constructor(
    private readonly page: Page,
    private readonly cdp: CDPSession,
    private readonly log: PageLog,
    private readonly opts: DriverOptions,
  ) {}

  /**
   * Opens the render page in `context` and waits until its API is installed.
   * @throws RenderError when the page does not load; InterruptedError on abort.
   */
  static async open(context: BrowserContext, opts: DriverOptions): Promise<RenderPageDriver> {
    const page = await context.newPage();
    const log = watchPage(page, opts.io, opts.verbose);
    const ready = async () => {
      await page.goto(opts.url);
      await page.waitForFunction(
        () => typeof (globalThis as unknown as Partial<SwarmWindow>).__swarmloom?.init === "function",
        undefined,
        { timeout: PAGE_READY_MS },
      );
      const cdp = await context.newCDPSession(page);
      // Device metrics emulation is per CDP session: repeat the viewport and scale on ours,
      // otherwise captureScreenshot returns frames in CSS pixels.
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: opts.width,
        height: opts.height,
        deviceScaleFactor: opts.scale,
        mobile: false,
      });
      return cdp;
    };
    const cdp = await guard(ready(), "Opening the render page", PAGE_READY_MS + 5000, opts.signal).catch(
      (error: unknown) => {
        throw failure("Opening the render page", error, log);
      },
    );
    return new RenderPageDriver(page, cdp, log, opts);
  }

  /** Loads the input; resolves with the page's estimate of the video length (0 when unknown) and what it loaded. */
  async init(init: RenderInit): Promise<RenderInfo> {
    const result = await this.call("Loading the input", INIT_MS, () =>
      this.page.evaluate((o) => (globalThis as unknown as SwarmWindow).__swarmloom.init(o), init),
    );
    return asRenderInfo(result);
  }

  async step(ms: number): Promise<StepResult> {
    const result = await this.call("A render step", STEP_MS, () =>
      this.page.evaluate((m) => (globalThis as unknown as SwarmWindow).__swarmloom.step(m), ms),
    );
    return asStepResult(result);
  }

  async capture(): Promise<Uint8Array> {
    const params =
      this.opts.imageType === "jpeg"
        ? { format: "jpeg" as const, quality: 90, optimizeForSpeed: true }
        : { format: "png" as const, optimizeForSpeed: true };
    const shot = await this.call("Capturing a frame", STEP_MS, () => this.cdp.send("Page.captureScreenshot", params));
    if (!shot.data) throw new RenderError("The browser returned an empty screenshot");
    return Buffer.from(shot.data, "base64");
  }

  /** The soundtrack, `durationMs` long (the video's length), as WAV bytes, or null when the page produced none. */
  async audioWav(durationMs: number): Promise<Uint8Array | null> {
    const base64 = await this.call("Rendering the soundtrack", AUDIO_MS, () =>
      this.page.evaluate((ms) => (globalThis as unknown as SwarmWindow).__swarmloom.audioWav(ms), durationMs),
    );
    return typeof base64 === "string" && base64.length > 0 ? Buffer.from(base64, "base64") : null;
  }

  /**
   * The run's sound events in video ms.
   * @throws RenderError when the render page is too old to report them.
   */
  async soundLog(): Promise<SoundEvent[]> {
    const supported = await this.page.evaluate(
      () => typeof (globalThis as unknown as SwarmWindow).__swarmloom.soundLog === "function",
    );
    if (!supported) throw new RenderError("This render page cannot report its sound log (--events-out)");
    const result = await this.call("Reading the sound log", AUDIO_MS, () =>
      this.page.evaluate(() => (globalThis as unknown as SwarmWindow).__swarmloom.soundLog?.() ?? []),
    );
    return asSoundEvents(result);
  }

  /**
   * Fonts the browser used for the text on screen now, merged per font and sorted by family.
   * Best effort: null when the browser does not report them.
   */
  async platformFonts(): Promise<PlatformFont[] | null> {
    try {
      const { root } = (await this.cdp.send("DOM.getDocument", { depth: -1, pierce: true })) as { root: DomNode };
      await this.cdp.send("CSS.enable");
      const fonts = new Map<string, PlatformFont>();
      for (const nodeId of textElements(root).slice(0, MAX_FONT_NODES)) {
        const result = (await this.cdp.send("CSS.getPlatformFontsForNode", { nodeId })) as {
          fonts: { familyName: string; postScriptName?: string; isCustomFont: boolean; glyphCount: number }[];
        };
        for (const f of result.fonts) {
          const postScriptName = f.postScriptName ?? "";
          const key = `${f.familyName}\u0000${postScriptName}\u0000${f.isCustomFont}`;
          const seen = fonts.get(key);
          if (seen) seen.glyphs += f.glyphCount;
          else fonts.set(key, { family: f.familyName, postScriptName, custom: f.isCustomFont, glyphs: f.glyphCount });
        }
      }
      await this.cdp.send("CSS.disable").catch(() => {});
      return [...fonts.values()].sort(
        (a, b) => a.family.localeCompare(b.family) || a.postScriptName.localeCompare(b.postScriptName),
      );
    } catch {
      return null;
    }
  }

  /** Lets the page release its player; never throws. */
  async dispose(): Promise<void> {
    await this.page.evaluate(() => (globalThis as unknown as SwarmWindow).__swarmloom.dispose()).catch(() => {});
  }

  private call<T>(what: string, ms: number, run: () => Promise<T>): Promise<T> {
    return guard(run(), what, ms, this.opts.signal).catch((error: unknown) => {
      throw failure(what, error, this.log);
    });
  }
}

/** Elements (light DOM, shadow roots and frames) that directly hold non-blank text, in document order. */
function textElements(root: DomNode): number[] {
  const ids: number[] = [];
  const visit = (node: DomNode): void => {
    if (node.nodeType === 1 && node.children?.some((c) => c.nodeType === 3 && c.nodeValue?.trim()))
      ids.push(node.nodeId);
    for (const child of node.shadowRoots ?? []) visit(child);
    for (const child of node.children ?? []) visit(child);
    if (node.contentDocument) visit(node.contentDocument);
  };
  visit(root);
  return ids;
}

/** Turns a Playwright/page error into a RenderError with the page's recent errors attached. */
export function failure(what: string, error: unknown, log: PageLog | undefined): CliError {
  if (error instanceof CliError) return error;
  const recent = log?.recent() ?? [];
  const details = recent.length ? `\nPage errors:\n  ${recent.join("\n  ")}` : "";
  return new RenderError(`${what} failed: ${briefMessage(error)}${details}`, undefined, { cause: error });
}
