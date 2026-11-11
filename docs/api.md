---
title: JavaScript API
description: createPlayer、格式适配器、DOM 快照、时钟与编排插件。
---

# JavaScript API

::: info 当前状态
本页的 API 都已实现：`createPlayer()`（`@swarmloom/core`）、`load()` 与内置适配器（`@swarmloom/formats`）、`snapshot()`（`@swarmloom/snapshot-dom`），以及 `exportFrames()`、`renderAudioWav()` 和 `recordElement()`（`@swarmloom/export`）。各格式的成熟度见[格式支持](./formats.md)。这些包还没有发布到 npm，目前从源码检出使用。
:::

## 从输入到播放器

```ts
import { createPlayer } from "@swarmloom/core";
import { load } from "@swarmloom/formats";

const source = await load({
  name: "README.md",
  type: "text/markdown",
  text: "# Hello\n\nA swarm builds this paragraph.",
});

const host = document.querySelector<HTMLElement>("#stage");
if (!host) throw new Error("Missing #stage");

const player = createPlayer({
  blueprint: source.blueprint,
  plugins: source.plugins,
  host,
  mode: "inline",
  agents: "auto",
  speed: 1,
  seed: 7,
  controls: true,
  labels: "roles",
  follow: "tour",
  sound: { enabled: true, pack: "studio", volume: 0.7 },
  finale: "flock",
});

const offState = player.on("state", ({ state }) => {
  console.log(state);
});

await player.play(); // Resolves after the build, before the finale ends.

const dispose = () => {
  offState();
  player.destroy();
  source.dispose?.();
};
// Call dispose() from the host component's unmount hook.
```

实际应用中把 `dispose()` 放在组件卸载逻辑里，而不是紧跟在初始化后执行。`LoadedSource.dispose()` 可能释放对象 URL、沙箱和 GPU 资源，应在播放器销毁后调用。

## `createPlayer(options)`

`blueprint` 必填，其余选项如下。

| 选项 | 类型 / 默认值 | 说明 |
| --- | --- | --- |
| `mode` | `"overlay"` / `"inline"` | 覆盖真实页面，或在 `host` 内滚动播放 |
| `host` | `HTMLElement` | Shadow Root 挂载位置；覆盖模式默认 `document.body` |
| `agents` | `number` / `"auto"` | 光标数量；自动模式按场景和视口在 8–64 之间调整 |
| `speed` | `number`，默认 1 | 大于 0 的速度倍率 |
| `seed` | `number` | 所有引擎随机性的种子 |
| `clock` | `Clock` | 默认 `RealtimeClock`；逐帧导出使用 `VirtualClock` |
| `sound` | `boolean` / `SoundOptions` | 开关、音量、音效包、BPM 和按拍构建 |
| `theme` | `auto` / `light` / `dark` / `ThemeSpec` | 主题或自定义调色板 |
| `labels` | `LabelMode` / `string[]` | `names`、`agents`、`roles`、`none` 或自定义标签；`none` 同时隐藏状态泡 |
| `follow` | `scroll` / `tour` / `none` | 跟随用户、自动巡航或固定视口 |
| `reducedMotion` | `auto` / `boolean` | 默认尊重系统减少动态偏好 |
| `intro` | `boolean` | 是否播放图标环绕与扇出开场 |
| `finale` | `flock` / `halo` / `none` | 群聚、音频响应光环或无结尾 |
| `controls` | `boolean` | 是否显示内置工具栏 |
| `locale` | BCP 47 字符串 | 工具栏语言；默认 `navigator.language` |
| `plugins` | `Plugin[]` | 自定义编排、渲染器或舞台插件 |
| `onLive` | `() => void` | 上线或关闭后恢复内容的回调 |
| `onClose` | `() => void` | 播放器关闭回调 |

`SoundOptions`：

| 成员 | 说明 |
| --- | --- |
| `enabled` | 是否启用声音 |
| `volume` | 0–1 主音量 |
| `pack` | `studio`、`soft`、`8bit`、`silent-keys` 或自定义包 ID |
| `bpm` | 音乐网格速度 |
| `beatSync` | 音符与任务起点是否按拍量化 |

`ThemeSpec` 可提供 `palette`、`accent`、`select` 和 `chrome`。光标颜色按 `palette` 顺序循环。

## `Player`

| 成员 | 说明 |
| --- | --- |
| `state` | `idle`、`intro`、`building`、`paused`、`finale`、`done`、`live` 或 `destroyed` |
| `progress` | `{ built, total }` 图层进度 |
| `soundLog` | 到目前为止的只读声音事件日志 |
| `play()` | 开始开场与构建；Promise 在构建完成时解决，不等待结尾结束 |
| `pause()` / `resume()` | 暂停或继续 |
| `setSpeed(speed)` | 修改速度 |
| `setSound(enabled)` | 开关声音 |
| `setFollow(mode)` | 修改跟随模式 |
| `replay()` | 重置并重新播放 |
| `goLive()` | 返回真实页面或最终静态内容 |
| `ready()` | 等待当前挂载图层的图片与字体解码 |
| `eta()` | 当前速度下预计剩余构建时间，毫秒 |
| `finish()` | 可选成员：约一秒内完成剩余构建，然后进入结尾（工具栏“完成”，快捷键 F） |
| `seek(t)` | 可选成员：跳到 `play()` 之后的第 `t` 毫秒；向后快进，向前从头重放，期间不绘制、不发声 |
| `setFinale(mode)` | 可选成员：修改结尾，结尾进行中也立即生效 |
| `on(type, fn)` | 订阅事件，返回取消订阅函数 |
| `destroy()` | 释放播放器、舞台、音频和插件资源 |

事件类型：

```ts
type PlayerEvent =
  | { type: "state"; state: PlayerState }
  | { type: "progress"; built: number; total: number }
  | { type: "sound"; event: SoundEvent }
  | { type: "error"; error: Error };
```

销毁前取消业务层订阅，并处理 `play()` 的拒绝；不要把资源加载错误静默吞掉。

## 格式加载与适配器

### `load(input, ctx?, options?)`

`@swarmloom/formats` 探测输入，动态导入匹配适配器，返回 `LoadedSource`：

```ts
interface LoadedSource {
  blueprint: Blueprint;
  plugins?: Plugin[];
  dispose?(): void;
}
```

`SourceInput` 可包含 `name`、`type`、`bytes`、`text`、`url` 或 `element`。提供与内容相符的一种主要数据；`name` 和 `type` 用于探测，不代替正文。

浏览器外调用必须显式提供 `ctx.document`。`AdapterContext` 包含：

| 成员 | 说明 |
| --- | --- |
| `document` | 用于隐藏沙箱、布局和测量 |
| `width` | 可重排内容的布局宽度 |
| `theme` | `light` 或 `dark` |
| `locale` | 可选 BCP 47 语言 |
| `maxLayers` | 图层上限；达到时设置 `Blueprint.truncated` |
| `signal` | 可选取消信号 |

第三个参数是 `LoadOptions`：`registry`（自定义注册表，默认 `formats`）、`format`（跳过探测，直接指定适配器 ID、扩展名或 MIME）、`maxBytes`（默认 50 MB）、`fetch`（默认先下载只有 `url` 的输入；设为 `false` 时原样交给适配器）和 `signal`。也可以直接传注册表数组，作为 `{ registry }` 的简写。

未知格式、超出大小限制、空输入、加密文档和下载失败会以 `SourceError` 拒绝，`code` 说明原因。适配器自身的非法输入、缺失资源和解码错误原样向上抛出。

### 注册适配器

适配器实现以下接口：

```ts
interface Adapter {
  id: string;
  label: string;
  extensions: string[];
  mime: string[];
  sniff?(head: Uint8Array, name?: string): boolean;
  load(input: SourceInput, ctx: AdapterContext): Promise<LoadedSource>;
}
```

`FormatEntry` 额外提供懒加载器。把它加入自定义注册表，不必修改核心：

```ts
import { formats, load, type FormatEntry } from "@swarmloom/formats";

const entry: FormatEntry = {
  id: "my-format",
  label: "My format",
  extensions: ["mine"],
  mime: ["application/x-mine"],
  loader: () => import("./my-adapter").then((m) => m.myAdapter),
};

const source = await load(input, ctx, [...formats, entry]);
```

适配器应遵守取消信号与图层预算，清洗不受信内容，不执行文档中的宏或脚本，并在 `dispose()` 中释放资源。

### `detect` 与 `formats`

- `detect(input, registry?)` 根据扩展名、MIME 和 magic bytes 探测适配器 ID。
- `formats` 是内置 `FormatEntry[]` 注册表，描述各适配器的懒加载入口。

## DOM 快照

```ts
import { snapshot, snapshotHtml } from "@swarmloom/snapshot-dom";

const page = await snapshot(document, {
  origin: "document",
  maxLayers: 6000,
  prescroll: true,
  inlineImages: true,
});

const fragment = await snapshotHtml("<h1>Hello</h1>", {
  width: 1280,
  baseUrl: location.href,
  css: "h1 { font-family: system-ui; }",
});
```

`snapshot()` 接受 `Element | Document`。常用选项：

| 选项 | 默认值 / 作用 |
| --- | --- |
| `origin` | Document/body/html 默认 `document`，其他元素默认 `element` |
| `source` | 写入 Blueprint 的来源信息 |
| `maxLayers` | 6000；超限保留阅读顺序并设置 `truncated` |
| `maxHeight` | 60000 CSS px |
| `detectDuplicates` | true；重复兄弟节点转为母版与副本 |
| `detectGuides` | true；共享边缘与基线转为参考线 |
| `screenshot` | 用于 WebGL、播放中视频和跨源 iframe 的可见视口截图 |
| `prescroll` | false；捕获前快速滚动以触发懒加载 |
| `inlineImages` | false；同源图片转 data URL，便于跨文档播放 |
| `signal` | 取消快照 |

`snapshotHtml()` 额外要求 `width`，并支持 `css`、`document`、`baseUrl`、`background`、`scheme` 和 `icon`。

::: warning 安全边界
`snapshotHtml()` 负责隔离排版和测量，不应被当作通用 HTML 清洗器。不受信 HTML 必须先按白名单清洗；脚本、事件属性、表单和外部资源需要独立的拒绝策略。
:::

## 编排插件

插件通过 `tasks` 添加生成器编排，通过 `renderers` 添加自定义图层渲染。`setup`、`frame` 和 `project` 可支持 WebGL 等自带舞台。

下面是一个小型 `demo:stamp` 编排：移动光标、拖出占位框、分 12 步揭示，再清理辅助层。

```ts
import { definePlugin, type CustomLayer, type TaskGen } from "@swarmloom/core";

export const stampPlugin = definePlugin({
  name: "demo-stamp",
  tasks: {
    "demo:stamp": (agent, layer: CustomLayer, stage): TaskGen =>
      (function* (): TaskGen {
        const { x, y, w, h } = layer.box;
        const ghost = stage.overlay("ghost-rect", { x, y, w, h });

        try {
          agent.setCursor("move");
          agent.say("stamping");
          yield* agent.moveTo(x, y, { dur: 240, ease: "out" });
          agent.press();
          yield* agent.dragTo(x + w, y + h, { dur: 420, ease: "inOut" });

          for (let step = 1; step <= 12; step += 1) {
            stage.reveal(layer.id, step / 12);
            yield 35; // Engine milliseconds, scaled by player speed.
          }
          agent.sound("note", { vel: 0.6 });
        } finally {
          ghost.remove();
          agent.release();
          agent.say("");
          stage.finish(layer.id);
        }
      })(),
  },
});
```

把插件传给播放器：

```ts
const player = createPlayer({
  blueprint,
  plugins: [stampPlugin, ...sourcePlugins],
});
```

对应的自定义图层使用 `kind: "custom"` 和 `task: "demo:stamp"`。自定义图层还需要同名 renderer；文档适配器可以把二者打包在同一个插件中。

编排规则：

- 用 `yield` 的毫秒数表达时间；`yield undefined` 等待一帧。
- Promise 只用于图片、字体等资源解码，不用于墙钟计时。
- 随机性使用 `agent.rng`，不要调用 `Math.random()` 或 `Date.now()`。
- 在 `finally` 中移除 overlay、释放按压并调用 `stage.finish()`。
- `setup()` 可返回清理函数；`frame(now, dt)` 使用引擎时间。
- 有内部状态的插件提供 `perPlayer()`：每个播放器创建时调用一次并使用返回的新实例，同一个 `LoadedSource` 因而可以同时驱动多个播放器。
- 播放器以减少动态效果方式构建时 `stage.reducedMotion` 为 true，此时保持静止画面，不要自行启动动画。
- 不要在每帧创建大量 DOM 节点或反复读取布局。

## 时钟与随机数

```ts
import { RealtimeClock, VirtualClock, createRng } from "@swarmloom/core";

const realtime = new RealtimeClock({ maxDeltaMs: 100 });
const virtual = new VirtualClock();
const rng = createRng(42);

virtual.start();
virtual.advance(1000 / 30);
virtual.stop();
```

`VirtualClock.advance(ms)` 只在时钟运行时推进，且每次调用发出一次 tick。它不能在 tick 回调中重入，也不接受负数或非有限值。

相同种子与时钟只是确定性的一部分。字体、输入、视口、适配器和插件版本也必须固定。

## 逐帧与音频导出

`@swarmloom/export` 提供：

- `exportFrames(playerOptions, { fps, onFrame, tailMs?, maxDurationMs?, onWarning?, signal? })`：在 `VirtualClock` 上逐帧驱动播放器。每帧的资源就绪后调用 `onFrame(index, timeMs)`，第 `n` 帧对应引擎时间 `n * 1000 / fps`；返回 `{ frames, durationMs, soundLog, warnings }`。可恢复的播放器错误进入 `onWarning` 和 `warnings`，导出继续；在 `onWarning` 中抛出即可中止；
- `renderAudioWav(soundLog, durationMs, options?)`：用 `OfflineAudioContext` 把声音事件日志渲染成与视频等长的 WAV 字节；
- `recordElement(target, options?)`：在点击处理函数中调用，请求共享当前标签页并裁剪到元素，用 `MediaRecorder` 实时录制。它不保证确定性；`canRecordElement()` 判断是否支持，失败时抛出带 `code` 的 `RecordingError`。

```ts
import { exportFrames, renderAudioWav } from "@swarmloom/export";

const { frames, durationMs, soundLog } = await exportFrames(
  { blueprint: source.blueprint, plugins: source.plugins, host, mode: "inline", seed: 7 },
  {
    fps: 30,
    tailMs: 2000,
    onFrame: async (index) => {
      await captureFrame(index); // 例如截图或把画布交给编码器
    },
  },
);
const wav = await renderAudioWav(soundLog, durationMs);
```

`swarmloom render` 命令行用的就是同一套逐帧流程，见 [CLI](./cli.md)。

核心还导出 `renderOffline()` 和 `encodeWav()`，供自定义音频管线使用。视频导出应始终等待 `player.ready()`，避免在字体和图片未解码时捕获。
