---
title: 快速开始
description: 通过扩展、Studio 或源码开始体验 SwarmLoom。
---

# 快速开始

::: info 当前状态
Studio 已经上线，可以打开文件、播放，并在页面内导出视频。扩展、CLI 和 `<swarm-loom>` 元素从源码构建后即可使用；商店条目和 npm 包尚未发布。
:::

SwarmLoom 有三种使用方式：在原网页上重建、在 Studio 中打开内容、在自己的项目中调用播放器。

## 在网页上重建 <Badge type="info" text="从源码构建" />

适合文章、文档站、落地页和普通应用界面。

1. 按[安装指南](./install)安装浏览器扩展。
2. 打开普通网页，点击工具栏中的 SwarmLoom 图标，或按 <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>W</kbd>。
3. 页面淡入空白舞台后，光标开始重建。空格暂停或继续，<kbd>1</kbd>、<kbd>2</kbd>、<kbd>3</kbd> 切换速度。
4. 按 <kbd>M</kbd> 开关声音，按 <kbd>T</kbd> 开关自动巡航。
5. 构建结束后选择“上线”，或按 <kbd>L</kbd>，恢复可交互的原页面。按 <kbd>R</kbd> 可以重播。

浏览器特权页、扩展商店页和内建 PDF 查看器不能注入重建脚本。此时使用“在 Studio 中打开”，或直接打开原文件。

## 在 Studio 中打开文件

适合 PDF、Word、Markdown、源码、图片和 3D 模型，也适合手机。

1. 打开 [SwarmLoom Studio](https://boulea7.github.io/swarmloom/studio/)。
2. 拖入文件，或选择“打开文件”“粘贴”“输入 URL”。
3. 选择示例也可以直接播放。首次开启声音时，需要一次点击或轻触来解锁浏览器音频。
4. 在设置抽屉中调整光标数量、速度、标签、主题、音效包和结尾。
5. 需要保存时选择“导出”，在页面内生成视频。不能编码视频（没有 WebCodecs）的浏览器改为给出等价的 CLI 命令。

Studio 默认在浏览器本地解析文件。打开远程 URL 时，浏览器会请求该 URL 所在站点。

## 嵌入自己的页面 <Badge type="info" text="从源码构建" />

使用 Web Component 时，注册标签并提供来源：

```html
<swarm-loom
  src="/demo.md"
  type="markdown"
  agents="24"
  speed="1"
  theme="auto"
  labels="roles"
  autoplay
  controls
  sound
></swarm-loom>
```

需要框架无关的 JavaScript 控制时，先用适配器生成 Blueprint，再调用 `createPlayer()`。完整示例见 [Web Component](./element) 和 [JavaScript API](./api)。

## 从源码启动开发环境

仓库开发环境需要 Node.js 22.12 或更高版本。

```bash
git clone https://github.com/Boulea7/swarmloom.git
cd swarmloom
corepack enable
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install
pnpm dev:studio
```

这会启动带热更新的 Studio Vite 开发服务器。

文档站也可以本地运行：

```bash
pnpm docs:dev
```

## 下一步

- [安装到不同浏览器和设备](./install)
- [了解每种格式如何构建](./formats)
- [掌握快捷键、跟随、声音与导出](./usage)
- [使用 CLI 做确定性导出](./cli)
