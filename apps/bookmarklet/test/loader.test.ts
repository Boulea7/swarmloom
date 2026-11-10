import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveBuildConfig } from "../scripts/config.mjs";
import { buildLoaderCode } from "../scripts/loader.mjs";
import {
  fillLoaderTemplate,
  MAX_BOOKMARKLET_LENGTH,
  OPTIONS_PLACEHOLDER,
  toBookmarkletUrl,
} from "../src/bookmarklet-url";
import { bookmarkletFor } from "../src/install/main";
import { runLoader } from "../src/loader";
import { GLOBAL_KEY, MSG_PAGE, SCRIPT_ID } from "../src/protocol";

const SCHEME = "javascript:";

/** Minified loader template for a build configuration, as scripts/build.mjs makes it. */
async function template(base?: string): Promise<string> {
  const config = resolveBuildConfig({ base });
  return buildLoaderCode({ bundleUrl: config.bundleUrl, studioUrl: config.studioUrl, options: OPTIONS_PLACEHOLDER });
}

/** Runs a bookmarklet the way a browser does: percent-decode after the scheme, then evaluate. */
function runBookmarklet(url: string): void {
  new Function(decodeURIComponent(url.slice(SCHEME.length)))();
}

afterEach(() => {
  Reflect.deleteProperty(window, GLOBAL_KEY);
  document.getElementById(SCRIPT_ID)?.remove();
  vi.restoreAllMocks();
});

describe("built bookmarklet", () => {
  it("stays under 1.5 KB and decodes to the loader code", async () => {
    const config = resolveBuildConfig({});
    const code = fillLoaderTemplate(await template(), "");
    const url = toBookmarkletUrl(code);

    expect(MAX_BOOKMARKLET_LENGTH).toBeLessThan(1.5 * 1024);
    expect(url.length).toBeLessThanOrEqual(MAX_BOOKMARKLET_LENGTH);
    expect(url).toMatch(/^javascript:[\x20-\x7e]+$/);
    expect(url).not.toContain("#");
    expect(decodeURIComponent(url.slice(SCHEME.length))).toBe(code);
    expect(() => new Function(code)).not.toThrow();
    expect(code).toContain(JSON.stringify(config.bundleUrl));

    // The longest variant the install page can produce (speed and sound changed) still fits.
    const custom = bookmarkletFor(await template(), { speed: 3, sound: false });
    expect(decodeURIComponent(custom)).toContain('"speed=3&sound=0"');
    expect(custom.length).toBeLessThanOrEqual(MAX_BOOKMARKLET_LENGTH);
  });

  it("injects the bundle as a module script carrying its options", async () => {
    // happy-dom refuses to load scripts, which sends the loader down the fallback path at once;
    // keep that path inert and capture the script element as it is created.
    vi.spyOn(window, "open").mockReturnValue(null);
    const create = vi.spyOn(document, "createElement");

    runBookmarklet(toBookmarkletUrl(fillLoaderTemplate(await template("http://localhost:9/"), "speed=2&sound=0")));

    const script = create.mock.results.map((r) => r.value).find((el) => el instanceof HTMLScriptElement);
    expect(script?.id).toBe(SCRIPT_ID);
    expect(script?.type).toBe("module");
    expect(script?.getAttribute("src")).toBe("http://localhost:9/bm/swarm.js");
    expect(script?.getAttribute("data-swarmloom-bm")).toBe("speed=2&sound=0");
  });

  it("toggles a running bundle instead of injecting it again", async () => {
    const toggle = vi.fn();
    Object.defineProperty(window, GLOBAL_KEY, { value: { toggle, state: "running" }, configurable: true });

    runBookmarklet(toBookmarkletUrl(fillLoaderTemplate(await template("http://localhost:9/"), "speed=3")));

    expect(toggle).toHaveBeenCalledWith("speed=3");
    expect(document.getElementById(SCRIPT_ID)).toBeNull();
  });

  it("rejects build URLs that would make a broken or insecure bookmarklet", () => {
    expect(() => resolveBuildConfig({ base: "http://example.com/" })).toThrow(/https/);
    expect(() => resolveBuildConfig({ base: "https://example.com/?x=1" })).toThrow(/query/);
    expect(() => resolveBuildConfig({ studio: "https://example.com/studio/" })).toThrow(/from=bookmarklet/);
    expect(() => fillLoaderTemplate("(()=>{})()", "")).toThrow(/exactly once/);
  });
});

describe("Studio fallback", () => {
  it("falls back once, offers a button when the popup is blocked, and answers only page requests", () => {
    const popup = { postMessage: vi.fn() };
    const open = vi
      .spyOn(window, "open")
      .mockReturnValueOnce(null)
      .mockReturnValue(popup as unknown as Window);
    runLoader(window, document, {
      bundleUrl: "http://localhost:9/bm/swarm.js",
      studioUrl: "../studio/?from=bookmarklet",
      options: "",
      timeout: 60_000,
    });
    const script = document.getElementById(SCRIPT_ID);

    // happy-dom may already have failed the load itself; further signals must not open more tabs.
    script?.dispatchEvent(new Event("error"));
    script?.dispatchEvent(new Event("error"));
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0]?.[0])).toBe("http://localhost:9/studio/?from=bookmarklet");

    const button = document.getElementById(SCRIPT_ID);
    expect(button).toBeInstanceOf(HTMLButtonElement);
    button?.click();
    expect(open).toHaveBeenCalledTimes(2);
    expect(document.getElementById(SCRIPT_ID)).toBeNull();

    window.dispatchEvent(new MessageEvent("message", { data: "hello" }));
    expect(popup.postMessage).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent("message", { data: MSG_PAGE }));
    expect(popup.postMessage).toHaveBeenCalledTimes(1);
    expect(popup.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MSG_PAGE, v: 1, reason: "error" }),
      "http://localhost:9",
    );
  });
});
