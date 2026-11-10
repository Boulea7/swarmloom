import { describe, expect, it } from "vitest";
import { en } from "../src/content/en";
import { FORMAT_IDS } from "../src/content/formats";
import { zh } from "../src/content/zh";
import { emptyBrand, emptyMedia, type MediaManifest, type RenderContext } from "../src/render/context";
import { esc } from "../src/render/html";
import { renderHome, renderNotFound } from "../src/render/page";
import { filmSource } from "../src/render/sections/media";

function context(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    base: "/swarmloom/",
    siteUrl: "https://example.test/swarmloom/",
    media: emptyMedia(),
    brand: emptyBrand(),
    fonts: [],
    earlyScript: "",
    entry: "/src/client/main.ts",
    stylesheet: "/src/styles/main.css",
    ...overrides,
  };
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("renderHome", () => {
  it("renders a complete page without any media or brand files", () => {
    const html = renderHome(zh, context());
    expect(html).toContain('<html lang="zh-CN"');
    expect(html).toContain('<link rel="canonical" href="https://example.test/swarmloom/">');
    expect(html).toContain('hreflang="en" href="https://example.test/swarmloom/en/"');
    expect(html).toContain('hreflang="x-default" href="https://example.test/swarmloom/"');
    // No film yet: the placeholder scene and the "coming soon" note, no video and no play button.
    expect(html).not.toContain("<video");
    expect(html).not.toContain("data-film-play");
    expect(html).toContain(zh.film.soon);
    expect(count(html, '<li class="fmt">')).toBe(FORMAT_IDS.length);
    expect(html).toContain('href="mailto:pvt.blocksongs@gmail.com"');
    expect(html).not.toContain("og:image");
    expect(html).toContain('name="twitter:card" content="summary"');
  });

  it("uses the media release when it is present", () => {
    const media: MediaManifest = {
      promo: { zh: true, en: false },
      promoPoster: true,
      captions: { zh: true, en: true },
      clips: { web: { mp4: true, webm: true, poster: true } },
    };
    const html = renderHome(zh, context({ media }));
    expect(html).toMatch(
      /<video class="film-video" preload="none" playsinline poster="\/swarmloom\/media\/promo-poster.avif"/,
    );
    expect(html).toContain('<source src="/swarmloom/media/promo-zh.mp4" type="video/mp4">');
    // The page language's captions come first and are the default track.
    expect(html).toMatch(
      /srclang="zh" label="[^"]+" default><track kind="captions" src="\/swarmloom\/media\/promo-en.vtt" srclang="en" label="[^"]+">/,
    );
    expect(html).toContain(zh.film.credits);
    expect(html).toContain('<source src="/swarmloom/media/clips/web.webm" type="video/webm">');
    expect(count(html, "data-lazy-video")).toBe(1);
    expect(html).toMatch(/<video class="fmt-video has-poster" muted loop playsinline preload="none"/);
  });

  it("falls back to the other language's film", () => {
    const media = { ...emptyMedia(), promo: { zh: false, en: true } };
    expect(filmSource(media, "zh")).toBe("en");
    expect(filmSource(media, "en")).toBe("en");
    expect(filmSource(emptyMedia(), "en")).toBeNull();
  });

  it("wires brand files into the social cards and the mark", () => {
    const brand = { og: { zh: true, en: true }, favicon: true, appleTouchIcon: true, logo: true };
    const html = renderHome(en, context({ brand }));
    expect(html).toContain('<meta property="og:image" content="https://example.test/swarmloom/brand/og-en.png">');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('srcset="/swarmloom/brand/logo-dark.svg"');
    expect(html).toContain('<link rel="apple-touch-icon" href="/swarmloom/brand/icon-192.png">');
  });
});

describe("renderNotFound", () => {
  it("is bilingual and kept out of the index", () => {
    const html = renderNotFound(zh, en, context());
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('rel="canonical"');
    expect(html).toContain(zh.notFound.title);
    expect(html).toContain(`lang="en">${esc(en.notFound.title)}`);
  });
});
