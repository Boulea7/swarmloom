/** File-system scans that feed the renderer's media and brand manifests. Node-only. */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { FORMAT_IDS } from "../src/content/formats";
import type { MediaManifest } from "../src/render/context";
import { type BrandManifest, emptyBrand, emptyMedia } from "../src/render/context";

/** True for a non-empty regular file. */
function present(file: string): boolean {
  try {
    const info = statSync(file);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

/** Which of the expected media files exist under `dir` (public/media). */
export function scanMedia(dir: string): MediaManifest {
  const media = emptyMedia();
  if (!existsSync(dir)) return media;
  media.promo = { zh: present(join(dir, "promo-zh.mp4")), en: present(join(dir, "promo-en.mp4")) };
  media.promoPoster = present(join(dir, "promo-poster.avif"));
  media.captions = { zh: present(join(dir, "promo-zh.vtt")), en: present(join(dir, "promo-en.vtt")) };
  for (const id of FORMAT_IDS) {
    const clip = {
      mp4: present(join(dir, "clips", `${id}.mp4`)),
      webm: present(join(dir, "clips", `${id}.webm`)),
      poster: present(join(dir, "clips", `${id}.avif`)),
    };
    if (clip.mp4 || clip.webm) media.clips[id] = clip;
  }
  return media;
}

/** Which brand files exist in `dir` (assets/brand). */
export function scanBrand(dir: string): BrandManifest {
  const brand = emptyBrand();
  if (!existsSync(dir)) return brand;
  brand.og = { zh: present(join(dir, "og-zh.png")), en: present(join(dir, "og-en.png")) };
  brand.favicon = present(join(dir, "favicon.svg"));
  brand.appleTouchIcon = present(join(dir, "icon-192.png"));
  brand.logo = present(join(dir, "logo.svg")) && present(join(dir, "logo-dark.svg"));
  return brand;
}
