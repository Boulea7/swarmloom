import type { DefaultTheme } from "vitepress";
import { defineConfig } from "vitepress";

const studioUrl = "https://boulea7.github.io/swarmloom/studio/";
const repositoryUrl = "https://github.com/Boulea7/swarmloom";

const zhSidebar: DefaultTheme.Sidebar = [
  {
    text: "开始",
    items: [
      { text: "介绍", link: "/" },
      { text: "快速开始", link: "/getting-started" },
      { text: "安装", link: "/install" },
      { text: "支持的格式", link: "/formats" },
    ],
  },
  {
    text: "使用",
    items: [
      { text: "使用技巧", link: "/usage" },
      { text: "Studio", link: "/studio" },
      { text: "性能", link: "/performance" },
      { text: "性能基准", link: "/benchmarks" },
    ],
  },
  {
    text: "开发者",
    items: [
      { text: "CLI", link: "/cli" },
      { text: "Web Component", link: "/element" },
      { text: "JavaScript API", link: "/api" },
    ],
  },
  {
    text: "项目",
    items: [
      { text: "隐私", link: "/privacy" },
      { text: "FAQ 与故障排查", link: "/faq" },
      { text: "致谢与许可", link: "/credits" },
    ],
  },
];

const enSidebar: DefaultTheme.Sidebar = [
  {
    text: "Start",
    items: [
      { text: "Introduction", link: "/en/" },
      { text: "Getting started", link: "/en/getting-started" },
      { text: "Install", link: "/en/install" },
      { text: "Supported formats", link: "/en/formats" },
    ],
  },
  {
    text: "Use",
    items: [
      { text: "Usage", link: "/en/usage" },
      { text: "Studio", link: "/en/studio" },
      { text: "Performance", link: "/en/performance" },
      { text: "Benchmarks", link: "/en/benchmarks" },
    ],
  },
  {
    text: "Developers",
    items: [
      { text: "CLI", link: "/en/cli" },
      { text: "Web Component", link: "/en/element" },
      { text: "JavaScript API", link: "/en/api" },
    ],
  },
  {
    text: "Project",
    items: [
      { text: "Privacy", link: "/en/privacy" },
      { text: "FAQ and troubleshooting", link: "/en/faq" },
      { text: "Credits and licences", link: "/en/credits" },
    ],
  },
];

export default defineConfig({
  title: "SwarmLoom",
  description: "让一群光标，把它织出来。",
  base: process.env.SWARMLOOM_DOCS_BASE ?? "/swarmloom/docs/",
  cleanUrls: true,
  lastUpdated: true,
  head: [["meta", { name: "theme-color", content: "#5B5BF7" }]],
  markdown: { lineNumbers: true },
  locales: {
    root: {
      label: "简体中文",
      lang: "zh-CN",
      title: "SwarmLoom 群织",
      description: "一群光标当着你的面，把网页、文档、动画、代码、图片和 3D 模型织出来。",
      themeConfig: {
        nav: [
          { text: "指南", link: "/getting-started", activeMatch: "^/(getting-started|install|usage)" },
          { text: "格式", link: "/formats" },
          { text: "API", link: "/api", activeMatch: "^/(api|cli|element)" },
          { text: "Studio", link: studioUrl },
        ],
        sidebar: zhSidebar,
        outline: { label: "本页内容", level: [2, 3] },
        editLink: {
          pattern: `${repositoryUrl}/edit/main/docs/:path`,
          text: "在 GitHub 上编辑此页",
        },
        lastUpdated: { text: "最后更新" },
        docFooter: { prev: "上一页", next: "下一页" },
        returnToTopLabel: "回到顶部",
        sidebarMenuLabel: "菜单",
        darkModeSwitchLabel: "外观",
        lightModeSwitchTitle: "切换到浅色模式",
        darkModeSwitchTitle: "切换到深色模式",
        langMenuLabel: "切换语言",
        skipToContentLabel: "跳到正文",
        footer: {
          message: "以 MIT 许可发布。Clean-room 原创实现。",
          copyright: "SwarmLoom 群织",
        },
      },
    },
    en: {
      label: "English",
      lang: "en",
      link: "/en/",
      title: "SwarmLoom",
      description: "Watch a swarm of cursors weave pages, documents, animation, code, images and 3D models into being.",
      themeConfig: {
        nav: [
          { text: "Guide", link: "/en/getting-started", activeMatch: "^/en/(getting-started|install|usage)" },
          { text: "Formats", link: "/en/formats" },
          { text: "API", link: "/en/api", activeMatch: "^/en/(api|cli|element)" },
          { text: "Studio", link: studioUrl },
        ],
        sidebar: enSidebar,
        outline: { label: "On this page", level: [2, 3] },
        editLink: {
          pattern: `${repositoryUrl}/edit/main/docs/:path`,
          text: "Edit this page on GitHub",
        },
        lastUpdated: { text: "Last updated" },
        docFooter: { prev: "Previous", next: "Next" },
        returnToTopLabel: "Back to top",
        sidebarMenuLabel: "Menu",
        darkModeSwitchLabel: "Appearance",
        lightModeSwitchTitle: "Switch to light mode",
        darkModeSwitchTitle: "Switch to dark mode",
        langMenuLabel: "Change language",
        skipToContentLabel: "Skip to content",
        footer: {
          message: "Released under the MIT Licence. An original clean-room implementation.",
          copyright: "SwarmLoom",
        },
      },
    },
  },
  themeConfig: {
    socialLinks: [{ icon: "github", link: repositoryUrl }],
    search: {
      provider: "local",
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: "搜索文档", buttonAriaLabel: "搜索文档" },
              modal: {
                noResultsText: "没有找到相关结果",
                resetButtonTitle: "清除搜索",
                backButtonTitle: "关闭搜索",
                displayDetails: "显示详细列表",
                footer: { selectText: "选择", navigateText: "切换", closeText: "关闭" },
              },
            },
          },
        },
      },
    },
  },
});
