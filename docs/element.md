---
title: Web Component
description: 使用 <swarm-loom> 在任意网页中嵌入光标重建。
---

# Web Component

::: info 当前状态
元素已经可以加载、播放并响应下面的属性。`@swarmloom/element` 还没有发布到 npm，目前需要从源码构建。
:::

`<swarm-loom>` 把格式加载与播放器封装成自定义元素，适合文档站、产品首页和框架无关的嵌入。

## 安装与注册

`@swarmloom/element` 还没有发布到 npm，目前从源码构建（需要 Node.js 22.12 或更高版本）：

```bash
git clone https://github.com/Boulea7/swarmloom.git
cd swarmloom
corepack enable
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install
pnpm --filter "@swarmloom/element..." build
```

最后一条命令构建元素及其依赖的工作区包，产物写入 `packages/element/dist/`。之后任选一种方式使用：

- **不用打包器**：把整个 `packages/element/dist/` 目录复制到站点，引入[脚本构建](#脚本构建)，它会自行注册元素。
- **使用打包器**：把构建好的目录安装到项目中，再按下面的方式注册元素。

  ```bash
  npm install /path/to/swarmloom/packages/element
  # 或使用 pnpm：
  pnpm add link:/path/to/swarmloom/packages/element
  ```

  两者都以链接方式引用该目录而不是复制，所以要保留这份源码，拉取更新后重新构建。

发布到 npm 后，这一步改为 `npm install @swarmloom/element`。

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

布尔属性出现即开启，空值（如 `<swarm-loom autoplay>`）也算开启；值为 `false`、`off`、`no` 或 `0`（不区分大小写）时关闭，移除属性同样关闭。`loop` 按同一规则开关：不带值时等待 1500 毫秒，`loop="0"` 表示关闭循环，不是零延迟。

## 使用 Light DOM 内容

没有 `src` 时，组件把自己的 Light DOM 子节点作为构建内容：

```html
<swarm-loom controls reduced-motion="auto">
  <article>
    <h1>Hello, swarm.</h1>
    <p>These elements become a Blueprint.</p>
  </article>
</swarm-loom>
```

组件会等子节点解析完成、其中的 Web 字体和图片加载后再生成快照。子节点留在页面布局中，页面没有指定高度时由它们决定元素高度。构建期间舞台覆盖在子节点上方，并带有 `aria-hidden`，辅助技术仍读取真实的子节点；播放器“上线”后，真实、可交互的子节点重新显示。

这是子树快照，不会执行其中的脚本或复制应用状态。设置了 `src` 时子节点不会显示，来源加载失败时也不会作为回退内容。

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

## 脚本构建 <Badge type="info" text="从源码构建" />

上面的构建同时生成 `dist/swarm-loom.global.js`，这是供无打包器页面使用的 IIFE 构建。脚本加载后会自行注册 `<swarm-loom>`，并通过 `window.SwarmLoom` 提供 `define`、`configure`、`SwarmLoomElement` 和 `TAG_NAME`。

```html
<script src="/vendor/swarmloom/swarm-loom.global.js"></script>
<swarm-loom src="/examples/intro.md" inview controls></swarm-loom>
```

脚本包含播放引擎，但不包含适配器代码。来源第一次需要某个适配器时，会相对脚本 URL 加载 `swarm-loom.adapters.js` 和 `chunks/` 中对应的分块；PDF 解析器等 Worker 文件从 `assets/` 加载。因此要把整个 `dist/` 目录一起部署，并用普通 `<script>` 引入（不加 `type="module"`），脚本才能找到自己的 URL。

`SwarmLoom.configure({ createPlayer, formats, maxBytes })` 替换所有元素共用的运行时，例如限制可用格式或降低下载上限（默认 50 MB），对调用之后加载的来源生效。

发布到 npm 后，unpkg 和 jsDelivr 会提供同一文件，例如 `https://cdn.jsdelivr.net/npm/@swarmloom/element@<version>/dist/swarm-loom.global.js`。生产环境请固定版本，不要引用未固定版本的 `latest`。

## 可访问性与性能

- 自动播放仍应提供暂停控件。
- 保留 `reduced-motion="auto"`，尊重系统减少动态偏好。
- 页面下方组件使用 `inview`，避免离屏播放消耗资源。
- 音效默认需要用户手势，不把自动播放失败当作异常。
- 多个实例会各自持有舞台和资源；移除不再需要的实例，避免长期页面中累积。
