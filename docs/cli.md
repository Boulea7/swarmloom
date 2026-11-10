---
title: CLI
description: swarmloom 命令行的 render、snapshot、serve、formats 和 doctor。
---

# CLI

::: warning 当前状态
CLI 包尚未发布。当前源码仅支持 `--help` 和 `--version`；所有子命令都会报告“not implemented yet”。以下命令与参数是已经确定的 v1 规划接口。
:::

CLI 使用本机 Chrome/Chromium 逐帧播放，在虚拟时钟上捕获画面，再交给 ffmpeg 编码。它适合批量导出、固定尺寸录像和可复现构建。

## 环境与安装

规划发布后可直接运行：

```bash
npx swarmloom --help
npx swarmloom render ./demo.md -o demo.mp4
```

也可以全局安装：

```bash
npm install -g swarmloom
```

CLI 运行时需要 Node.js 20 或更高版本。仓库源码开发使用 Node.js 22.12 或更高版本。

视频和动画编码还需要：

- Chrome 或 Chromium；
- 现代 ffmpeg。PNG 序列不需要 ffmpeg 合流。

运行 `swarmloom doctor` 可规划检查这两个依赖并输出修复建议。

## 全局选项

| 选项 | 作用 |
| --- | --- |
| `-h, --help` | 显示全局或子命令帮助 |
| `-v, --version` | 显示 CLI 版本 |
| `--quiet` | 隐藏渲染进度；错误仍写到 stderr |

## `render`

```text
swarmloom render <file|url> [-o out.mp4]
  [--format mp4|webm|gif|webp|png-seq]
  [--width 1280] [--height 720] [--scale 1] [--fps 30]
  [--agents auto] [--speed 1] [--seed 1]
  [--theme auto] [--labels names] [--finale flock]
  [--no-sound] [--tail 2500] [--max-duration 120]
  [--chrome <path>] [--ffmpeg <path>] [--quiet]
```

### 参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `<file\|url>` | 必填 | 本地文件或远程 URL；路径含空格时使用引号 |
| `-o <path>` | `out.mp4` | 输出文件；PNG 序列使用输出目录 |
| `--format <format>` | `mp4` | `mp4`、`webm`、`gif`、`webp` 或 `png-seq` |
| `--width <px>` | `1280` | 视口与输出宽度，CSS px |
| `--height <px>` | `720` | 视口与输出高度，CSS px |
| `--scale <number>` | `1` | 设备像素比；提高像素密度，不改变 CSS 布局尺寸 |
| `--fps <number>` | `30` | 每秒帧数，每帧推进 `1000 / fps` 毫秒 |
| `--agents <n\|auto>` | `auto` | 光标数量；`auto` 按场景调整 |
| `--speed <number>` | `1` | 构建速度倍率，必须大于 0 |
| `--seed <number>` | `1` | 随机种子；相同输入与配置复用相同序列 |
| `--theme <mode>` | `auto` | `auto`、`light` 或 `dark` |
| `--labels <mode>` | `names` | `names`、`agents`、`roles` 或 `none` |
| `--finale <mode>` | `flock` | `flock`、`halo` 或 `none` |
| `--no-sound` | 开启声音 | 禁用音轨与声音事件输出 |
| `--tail <ms>` | `2500` | 构建完成后的结尾停留时间 |
| `--max-duration <s>` | `120` | 最长引擎时长，单位秒；防止异常输入无限渲染 |
| `--chrome <path>` | 自动探测 | 指定 Chrome/Chromium 可执行文件 |
| `--ffmpeg <path>` | 自动探测 | 指定 ffmpeg 可执行文件 |
| `--quiet` | 关闭 | 不显示帧数与 ETA 进度 |

### 示例

导出 1280×720、30 fps 的 MP4：

```bash
swarmloom render ./README.md -o readme.mp4
```

导出无声音、固定种子的 WebM：

```bash
swarmloom render https://example.com -o site.webm \
  --format webm --seed 42 --no-sound
```

导出用于剪辑的 2× 像素 PNG 序列：

```bash
swarmloom render ./slides.pptx -o ./frames \
  --format png-seq --width 1920 --height 1080 --scale 2
```

只渲染前 15 秒，并明确指定工具路径：

```bash
swarmloom render ./model.glb -o model.mp4 \
  --max-duration 15 --chrome /path/to/chromium --ffmpeg /path/to/ffmpeg
```

## `snapshot`

```text
swarmloom snapshot <url|file> [-o blueprint.json] [--width 1280]
```

把页面或文件转换成 Blueprint JSON，用于检查图层、开发适配器或作为后续播放输入。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `<url\|file>` | 必填 | 要捕获的来源 |
| `-o <path>` | `blueprint.json` | 输出 JSON 文件 |
| `--width <px>` | `1280` | 排版与捕获视口宽度 |

```bash
swarmloom snapshot https://example.com -o example.blueprint.json --width 1440
```

Blueprint 可能包含页面文字和图片引用。分享快照前应像分享原内容一样检查敏感信息。

## `serve`

```text
swarmloom serve [--port 0] [--open]
```

在本机提供随 CLI 打包的 Studio。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--port <port>` | `0` | 监听端口；`0` 自动选择空闲端口 |
| `--open` | 关闭 | 启动后打开默认浏览器 |

```bash
swarmloom serve --port 4173 --open
```

服务面向本地工作流。不要把它直接暴露为处理不受信文件的公共服务。

## `formats`

```text
swarmloom formats
```

输出适配器 ID、名称、扩展名和 MIME 类型表，反映当前 CLI 实际打包的注册表。新适配器发布后，以该命令结果为准。

## `doctor`

```text
swarmloom doctor
```

检查浏览器与 ffmpeg 的发现结果，打印版本、路径和缺失依赖的修复提示。

浏览器发现顺序：

1. `--chrome`；
2. `SWARMLOOM_CHROME` 环境变量；
3. Playwright 缓存中的 chromium-headless-shell；
4. 系统安装的 Chrome、Chromium 或 Edge。

都找不到时，`doctor` 会提示运行 `npx playwright install chromium-headless-shell`。

ffmpeg 发现顺序：

1. `--ffmpeg`；
2. `SWARMLOOM_FFMPEG` 环境变量；
3. `PATH`。

CLI 不随包分发 ffmpeg，请自行安装。

```bash
SWARMLOOM_CHROME=/path/to/chromium \
SWARMLOOM_FFMPEG=/path/to/ffmpeg \
swarmloom doctor
```

## 输出与退出码

正常进度写到 stderr，包括当前帧和 ETA；文件数据不会混入进度输出。规划退出码：

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 命令或参数使用错误 |
| `2` | 缺少浏览器、ffmpeg 等依赖 |
| `3` | 解析、渲染或编码失败 |

## 确定性说明

CLI 固定视口、DPR、种子和帧步长。确定性来自播放器自己的虚拟时钟：每帧推进 `1000 / fps` 毫秒，等待当前帧资源就绪后截图，不依赖浏览器的 BeginFrame。声音事件离线渲染为 WAV，再与视频合流；合流不使用 `-shortest`，音频和视频时长一致。

确定性验收比较原始帧与 PCM，而不是 MP4/WebM 文件字节。编码器版本、线程和平台可能改变压缩字节，即使画面与声音一致。要复现结果，还应记录输入内容、CLI/适配器版本、浏览器、字体、ffmpeg 和导出参数。
