import { defineConfig } from "vitepress";

// GitHub Pages serves the docs under /swarmloom/; local dev uses "/".
const base = process.env.SWARMLOOM_DOCS_BASE || "/";

export default defineConfig({
  title: "SwarmLoom",
  base,
  cleanUrls: true,
  lastUpdated: true,
  locales: {
    root: {
      label: "简体中文",
      lang: "zh-CN",
      description: "一群光标当着你的面，把网页、文档、PDF、SVG、幻灯片、表格、代码、图片和 3D 模型一笔一画织出来。",
      themeConfig: {
        nav: [{ text: "Studio", link: "/studio/", target: "_self" }],
      },
    },
    en: {
      label: "English",
      lang: "en",
      link: "/en/",
      description:
        "A swarm of cursors rebuilds web pages, documents, PDFs, SVGs, slides, sheets, code, images and 3D models in front of you.",
      themeConfig: {
        nav: [{ text: "Studio", link: "/studio/", target: "_self" }],
      },
    },
  },
  themeConfig: {
    socialLinks: [{ icon: "github", link: "https://github.com/Boulea7/swarmloom" }],
  },
});
