---
title: Web Component
description: 使用 <swarm-loom> 在任意网页中嵌入光标重建。
---

# Web Component

::: warning 当前状态
`define()` 已可注册元素，但加载、播放和多数属性仍是桩实现。本页描述规划中的完整组件接口。
:::

`<swarm-loom>` 把格式加载与播放器封装成自定义元素，适合文档站、产品首页和框架无关的嵌入。

## 安装与注册

```bash
npm install @swarmloom/element
```

在客户端注册一次：

```ts
import { define } from "@swarmloom/element";

define();
```

`define()` 重复调用是安全的。没有 `customElements` 的环境会报错；标签已被其他类注册时也会报错。模块导入本身不访问 DOM，因此可以出现在 SSR 的模块图中，但应在客户端调用 `define()`。

```html
<swarm-loom
  src="/examples/intro.md"
  type="markdown"
  agents="24"
  speed="1"
  seed="7"
  theme="auto"
  labels="roles"
  finale="flock"
  autoplay
  controls
  sound
></swarm-loom>
```

给组件一个明确尺寸：

```css
swarm-loom {
  display: block;
  width: 100%;
  height: 480px;
}
```

## 属性

| 属性 | 类型 / 可选值 | 说明 |
| --- | --- | --- |
| `src` | URL 字符串 | 要加载的文件或页面；相对 URL 按当前文档解析 |
| `type` | 适配器 ID 或 MIME 提示 | 例如 `markdown`、`svg`、`pdf`；省略时探测 |
| `agents` | 正数或 `auto` | 光标数量；默认 `auto` |
| `speed` | 大于 0 的数字 | 构建速度，默认 `1` |
| `seed` | 有限数字 | 确定性随机种子 |
| `theme` | `auto` / `light` / `dark` | 舞台与工具栏主题 |
| `labels` | `names` / `agents` / `roles` / `none` | 光标标签 |
| `finale` | `flock` / `halo` / `none` | 构建结束后的行为 |
| `autoplay` | 布尔属性 | 加载完成后播放；声音仍需用户手势解锁 |
| `loop` | 毫秒数字 | 结束后等待指定毫秒再重播 |
| `controls` | 布尔属性 | 显示内置工具栏 |
| `sound` | 布尔属性 | 开启合成音效 |
| `inview` | 布尔属性 | 进入视口时通过 IntersectionObserver 开始 |
| `reduced-motion` | `auto` / `true` / `false` | 减少动态效果；默认跟随系统 |

布尔属性以元素上是否存在为准。需要关闭时移除属性，不要只写 `autoplay="false"` 并仍期待它关闭。

## 使用 Light DOM 内容

没有 `src` 时，组件规划把 Light DOM 子节点作为构建内容：

```html
<swarm-loom controls reduced-motion="auto">
  <article>
    <h1>Hello, swarm.</h1>
    <p>These elements become a Blueprint.</p>
  </article>
</swarm-loom>
```

这是子树快照，不会执行其中的脚本或复制应用状态。需要加载远程来源时不要同时依赖 Light DOM 回退内容。

## 方法

```ts
import type { SwarmLoomElement } from "@swarmloom/element";

const el = document.querySelector<SwarmLoomElement>("swarm-loom");
if (!el) throw new Error("Missing player");

await el.load({
  name: "note.md",
  type: "text/markdown",
  text: "# Hello\n\nBuilt by a swarm.",
});

el.play();
el.pause();
el.replay();
```

| 方法 | 作用 |
| --- | --- |
| `load(input)` | 加载 `SourceInput`，解析格式并准备 Blueprint；返回 Promise |
| `play()` | 开始或继续播放 |
| `pause()` | 暂停引擎时钟 |
| `replay()` | 清空当前揭示状态并从头播放 |

`input` 可以使用 `bytes`、`text`、`url` 或 `element`。不再需要组件时，从 DOM 移除它；组件的断开连接清理由实现负责。

## 事件

| 事件 | 时机 |
| --- | --- |
| `swarm-state` | 播放器状态改变 |
| `swarm-progress` | 已构建图层数或总图层数更新 |
| `swarm-done` | 构建完成 |

```js
const el = document.querySelector("swarm-loom");

el.addEventListener("swarm-state", (event) => {
  console.log("state", event.detail);
});
el.addEventListener("swarm-progress", (event) => {
  console.log("progress", event.detail);
});
el.addEventListener("swarm-done", () => {
  console.log("build complete");
});
```

事件负载以组件发布的类型声明为准；监听回调不应阻塞播放循环。

## CDN 构建 <Badge type="warning" text="规划中" />

包计划附带 `dist/swarm-loom.global.js` IIFE 构建，用于无打包器页面。正式示例会随发布版给出固定版本 URL 和全局名称；不要在生产环境引用未固定版本的 `latest`。

## 可访问性与性能

- 自动播放仍应提供暂停控件。
- 保留 `reduced-motion="auto"`，尊重系统减少动态偏好。
- 页面下方组件使用 `inview`，避免离屏播放消耗资源。
- 音效默认需要用户手势，不把自动播放失败当作异常。
- 多个实例会各自持有舞台和资源；移除不再需要的实例，避免长期页面中累积。
