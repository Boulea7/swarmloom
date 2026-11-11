<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/brand/hero-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="./assets/brand/hero-light.svg" />
    <img alt="SwarmLoom 群织：让一群光标，把它织出来" src="./assets/brand/hero-light.svg" width="1280" />
  </picture>
</p>

<h1 align="center">SwarmLoom · 群织</h1>

<p align="center"><strong>让一群光标，把它织出来。</strong><br/>网页、文档、代码、图片与 3D，由光标群当面重建，并导出带声音的视频。</p>

<p align="center">
  <a href="https://github.com/Boulea7/swarmloom/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Boulea7/swarmloom/actions/workflows/ci.yml/badge.svg?branch=main&amp;style=flat-square" /></a>
  <a href="https://github.com/Boulea7/swarmloom/releases"><img alt="Release planned" src="https://img.shields.io/badge/release-planned-5B5BF7?style=flat-square" /></a>
  <a href="./LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/license-MIT-5B5BF7?style=flat-square" /></a>
  <a href="./apps/cli"><img alt="npm package planned" src="https://img.shields.io/badge/npm-planned-5B5BF7?style=flat-square" /></a>
  <a href="./CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-5B5BF7?style=flat-square" /></a>
</p>

<p align="center"><strong>简体中文</strong> · <a href="./README.en.md">English</a> · <a href="./docs/i18n/README.zh-TW.md">繁體中文</a> · <a href="./docs/i18n/README.ja.md">日本語</a> · <a href="./docs/i18n/README.ko.md">한국어</a> · <a href="./docs/i18n/README.es.md">Español</a> · <a href="./docs/i18n/README.fr.md">Français</a> · <a href="./docs/i18n/README.de.md">Deutsch</a></p>

<p align="center">
  <a href="https://boulea7.github.io/swarmloom/studio/"><strong>在线试用 Studio</strong></a> ·
  <a href="https://boulea7.github.io/swarmloom/"><strong>官网</strong></a> ·
  <a href="https://boulea7.github.io/swarmloom/docs/"><strong>文档</strong></a>
</p>

## 视频介绍

<!-- VIDEO:main -->

从空白舞台到光标群重建，再到带声音的视频。主片正在制作；现在就可以在[在线 Studio](https://boulea7.github.io/swarmloom/studio/) 播放同样的真实示例，或查看[图文指南](https://boulea7.github.io/swarmloom/docs/getting-started.html)。

## 支持的格式

每张动图都来自 SwarmLoom 的真实渲染；点击打开对应的 Studio 示例。

<table>
  <tr>
    <td><a href="https://boulea7.github.io/swarmloom/studio/?example=web-demo"><img alt="光标群重建网页" src="./docs/assets/formats/web.webp" width="300" /></a><br/>网页 · DOM 快照</td>
    <td><a href="https://boulea7.github.io/swarmloom/studio/?example=html-landing"><img alt="HTML 页面逐块搭建" src="./docs/assets/formats/html.webp" width="300" /></a><br/>HTML / CSS</td>
    <td><a href="https://boulea7.github.io/swarmloom/studio/?example=svg-emblem"><img alt="SVG 路径描绘" src="./docs/assets/formats/svg.webp" width="300" /></a><br/>SVG · 路径与填充</td>
  </tr>
  <tr>
    <td><a href="https://boulea7.github.io/swarmloom/studio/?example=markdown-welcome.zh"><img alt="Markdown 标题与正文重建" src="./docs/assets/formats/markdown.webp" width="300" /></a><br/>Markdown / GFM / 数学公式</td>
    <td><a href="https://boulea7.github.io/swarmloom/studio/?example=docx-report"><img alt="DOCX 文档重建" src="./docs/assets/formats/docx.webp" width="300" /></a><br/>DOCX · 样式与表格</td>
    <td><a href="https://boulea7.github.io/swarmloom/studio/?example=doc-report"><img alt="DOC 正文重建" src="./docs/assets/formats/doc.webp" width="300" /></a><br/>DOC · 文本模式</td>
  </tr>
  <tr>
    <td><a href="https://boulea7.github.io/swarmloom/studio/?example=pdf-brochure"><img alt="PDF 页面重建" src="./docs/assets/formats/pdf.webp" width="300" /></a><br/>PDF · 固定版式</td>
    <td><a href="https://boulea7.github.io/swarmloom/studio/?example=slides-pitch"><img alt="PPTX 幻灯片重建" src="./docs/assets/formats/slides.webp" width="300" /></a><br/>PPTX · 幻灯片</td>
    <td><a href="https://boulea7.github.io/swarmloom/studio/?example=sheet-sales"><img alt="电子表格逐行搭建" src="./docs/assets/formats/sheet.webp" width="300" /></a><br/>XLSX / CSV / ODS</td>
  </tr>
  <tr>
    <td><a href="https://boulea7.github.io/swarmloom/studio/?example=code-swarm"><img alt="源码逐词输入" src="./docs/assets/formats/code.webp" width="300" /></a><br/>代码 / TXT</td>
    <td><a href="https://boulea7.github.io/swarmloom/studio/?example=image-scene"><img alt="位图线稿与色块重建" src="./docs/assets/formats/image.webp" width="300" /></a><br/>PNG / JPEG / WebP / AVIF</td>
    <td><a href="https://boulea7.github.io/swarmloom/studio/?example=3d-shuttle-glb"><img alt="3D 模型网格与材质重建" src="./docs/assets/formats/three.webp" width="300" /></a><br/>3D · GLB / OBJ / STL / PLY</td>
  </tr>
</table>

<details>
<summary>更多已实现的输入</summary>

OpenDocument、EPUB、RTF、OFD、Jupyter Notebook、asciinema 终端录制、Patch / Diff、XMind / FreeMind 也已进入同一注册表。完整扩展名与保真边界见[格式文档](https://boulea7.github.io/swarmloom/docs/formats.html)。

</details>

## 为什么选择 SwarmLoom

<table>
  <tr>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/brand/cards/web-dark.svg" /><img alt="网页重建卡片" src="./assets/brand/cards/web-light.svg" width="420" /></picture><br/><b>原页重建</b><br/>扩展捕获当前标签页或选区；结束后交还原页面。</td>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/brand/cards/docs-dark.svg" /><img alt="多格式文档卡片" src="./assets/brand/cards/docs-light.svg" width="420" /></picture><br/><b>多格式，同一舞台</b><br/>文档、代码、图片与 3D 统一转成 Blueprint。</td>
  </tr>
  <tr>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/brand/cards/video-dark.svg" /><img alt="视频导出卡片" src="./assets/brand/cards/video-light.svg" width="420" /></picture><br/><b>可复现导出</b><br/>固定 seed 与虚拟时钟；逐帧输出画面和同步声音。</td>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/brand/cards/platforms-dark.svg" /><img alt="多设备卡片" src="./assets/brand/cards/platforms-light.svg" width="420" /></picture><br/><b>跨设备播放</b><br/>Studio PWA、扩展与精简手表播放器共享核心。</td>
  </tr>
  <tr>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/brand/cards/code-dark.svg" /><img alt="代码与自动化卡片" src="./assets/brand/cards/code-light.svg" width="420" /></picture><br/><b>可嵌入、可自动化</b><br/>使用 <code>&lt;swarm-loom&gt;</code>、JavaScript API 或 CLI。</td>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/brand/cards/html-svg-dark.svg" /><img alt="HTML 与 SVG 卡片" src="./assets/brand/cards/html-svg-light.svg" width="420" /></picture><br/><b>隔离解析，按需加载</b><br/>HTML / SVG 不执行脚本；大型格式解析器独立分包。</td>
  </tr>
</table>

## 工作原理

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/how-it-works-dark.svg" />
    <img alt="捕获输入、生成 Blueprint、编排光标并播放或导出" src="./docs/assets/how-it-works-light.svg" width="760" />
  </picture>
</p>

适配器或 DOM 快照把输入转成统一 Blueprint；播放器按阅读顺序编排光标。Studio 实时播放，CLI 按虚拟时钟逐帧导出。

## 快速开始

### 无需安装：Studio

打开[在线 Studio](https://boulea7.github.io/swarmloom/studio/)，选择示例、拖入本地文件、粘贴文本或输入 URL。本地文件只在浏览器中处理；远程 URL 会由浏览器直接请求目标站点，并受 CORS 与访问权限限制。

### CLI

CLI 源码已可运行。完成下方的源码构建后，在仓库根目录执行：

```bash
node apps/cli/dist/cli.js render examples/svg/emblem.svg -o emblem.mp4 --seed 7 --fps 30
```

运行需要 Node.js 20+、Chrome/Chromium；MP4、WebM、GIF、WebP 还需要 FFmpeg 4+。`node apps/cli/dist/cli.js doctor` 会检查环境。`npx swarmloom@latest ...` 是 npm 发布后的计划入口，目前尚未发布。

### Web Component

`pnpm add @swarmloom/element` 为计划中的 npm 安装方式；当前可用 `pnpm --filter @swarmloom/element build` 从源码构建。组件接口已经实现：

```html
<script type="module">
  import { define } from "@swarmloom/element";
  define();
</script>

<swarm-loom
  src="./demo.md"
  type="markdown"
  agents="24"
  seed="7"
  theme="auto"
  labels="names"
  autoplay
  controls>
</swarm-loom>
```

完整属性、事件与 SSR 说明见[组件文档](https://boulea7.github.io/swarmloom/docs/element.html)。

## 按平台安装

商店条目与签名安装包尚未发布。当前扩展需从源码构建开发包；仓库要求 Node.js 22.12+，pnpm 版本由 `packageManager` 固定。

```bash
git clone https://github.com/Boulea7/swarmloom.git
cd swarmloom
corepack enable
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install
pnpm build
pnpm --filter @swarmloom/extension build
```

<details>
<summary>Chrome / Edge / Brave / Opera：加载开发包</summary>

- Chrome：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → `apps/extension/dist/chrome/`。
- Edge：`edge://extensions`，选择 `apps/extension/dist/edge/`。
- Brave / Opera：在各自的扩展管理页开启开发者模式，复用 `dist/chrome/`。
- 点击工具栏图标或按 Alt+Shift+W 重建普通网页；浏览器内部页、商店页与内建 PDF 查看器不能注入。

</details>

<details>
<summary>Firefox 桌面与 Android：临时调试，正式签名计划中</summary>

桌面打开 `about:debugging#/runtime/this-firefox` → 临时载入附加组件 → `apps/extension/dist/firefox/manifest.json`；重启后会被移除。Android 复用同一个包，开发验证需要 web-ext、ADB 与调试设备；正式安装需要 AMO 签名。移动真机验证前建议使用 Studio PWA。

</details>

<details>
<summary>Safari macOS / iOS / iPadOS / visionOS：源码构建；真机与签名计划中</summary>

在装有 Xcode 的 macOS 上运行 `pnpm --filter @swarmloom/extension package:safari`，然后在 Xcode 中打开 `apps/extension/build/safari/`，选择团队、签名并运行容器 App，最后在系统设置中启用扩展。真机分发需要 Apple Developer Program；各系统尚未完成真机验收。

</details>

<details>
<summary>PWA：桌面、Android、iOS / iPadOS</summary>

Chrome / Edge 打开 Studio 后使用地址栏或菜单中的“安装应用”；macOS Safari 用“添加到 Dock”；Android 用“安装应用”或“添加到主屏幕”；iOS / iPadOS 在 Safari 的分享菜单中选择“添加到主屏幕”。Firefox 桌面请直接使用普通标签页。

</details>

<details>
<summary>折叠屏与手表：诚实的边界</summary>

折叠屏无需单独安装；支持 Viewport Segments 时启用双栏或上下布局，否则回退普通响应式布局。手表没有扩展，也不承诺完整 PWA：打开 `?watch=1` 使用默认静音的精简播放器，`?round=1` 启用圆屏安全布局；复杂内容请在其他设备生成后导出。

</details>

## 与 Swarm Rebuild 相比

| 方向 | SwarmLoom 增加的能力 |
| --- | --- |
| 输入 | 从当前网页扩展到文档、代码、位图与 3D 模型。 |
| 载体 | 从浏览器扩展到 Studio PWA、CLI、Web Component 与手表查看。 |
| 输出 | 增加确定性逐帧导出、同步音轨与可校验的渲染清单。 |

## 文档

[快速开始](https://boulea7.github.io/swarmloom/docs/getting-started.html) · [格式与限制](https://boulea7.github.io/swarmloom/docs/formats.html) · [平台安装](https://boulea7.github.io/swarmloom/docs/install.html) · [CLI](https://boulea7.github.io/swarmloom/docs/cli.html) · [Web Component](https://boulea7.github.io/swarmloom/docs/element.html) · [隐私说明](./PRIVACY.md)

## FAQ

1. **这是 AI 智能体编排器吗？** 不是。光标是确定性的本地动画，重放的是内容的视觉构建过程，不会操作智能体；重建阶段也不会执行文档或 HTML 输入中的脚本。
2. **本地文件会上传吗？** 不会上传到 SwarmLoom 服务器。只有主动打开远程 URL 时浏览器才请求目标站点；HTML 引用的网络图片和字体也可在 Studio 设置中关闭。详见[隐私说明](./PRIVACY.md)。
3. **为什么某些页面不能原地重建？** 浏览器禁止向内部页、商店页和内建 PDF 查看器注入脚本。可改在 Studio 中导入文件；需要登录态的普通页面可使用扩展。
4. **相同 seed 会得到逐字节相同的 MP4 吗？** 不保证。相同输入、浏览器、字体、系统与参数可复现原始帧和 PCM；编码器版本与线程仍可能改变压缩字节。
5. **手机和手表能安装扩展吗？** 手机使用 Studio PWA；Firefox Android 的签名扩展仍在计划与验证中。手表只提供精简播放器，不提供扩展或后台播放。

## Roadmap

- **当前**：在线 Studio、19 类输入适配器、CLI 逐帧导出，以及 Chrome / Edge / Firefox / Safari 的源码构建。
- **下一步**：首个 GitHub Release 与 npm 包，扩展签名分发，以及移动端和 Safari 真机验收。
- **探索中**：更多格式与平台增强；不承诺日期。欢迎到 [Ideas](https://github.com/Boulea7/swarmloom/discussions/categories/ideas) 提建议。

## 贡献与支持

- 代码、文档、翻译与示例：先读 [CONTRIBUTING](./CONTRIBUTING.md) 和[行为准则](./CODE_OF_CONDUCT.md)。
- 使用问题：[Discussions Q&A](https://github.com/Boulea7/swarmloom/discussions/categories/q-a)；可复现缺陷：[Bug Report](https://github.com/Boulea7/swarmloom/issues/new?template=bug_report.yml)。
- 新格式建议：[Format Request](https://github.com/Boulea7/swarmloom/issues/new?template=format_request.yml)。
- 安全漏洞：只按 [SECURITY](./SECURITY.md) 私密报告，不要创建公开 issue。

## 致谢与 clean-room 边界

灵感来自 Joel Califa 的 Swarm 与 Dhvanil Patel 的 Swarm Rebuild。SwarmLoom 是独立的 clean-room 实现，未复用其代码、常量表或视觉资产，也与二者无隶属关系。光标、配色、图标、声音与实现均为原创或具有清晰许可；第三方说明见[素材与依赖清单](https://boulea7.github.io/swarmloom/docs/credits.html)。

## License

[MIT](./LICENSE) © 2026 Boulea7 and SwarmLoom contributors。
