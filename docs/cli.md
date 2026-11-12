---
title: CLI
description: swarmloom 命令行的 render、snapshot、serve、formats 和 doctor。
---

# CLI

::: warning 当前状态
`render`、`snapshot`、`serve`、`formats` 和 `doctor` 都已实现，但 `swarmloom` npm 包尚未发布，目前需要从源码构建后运行。各命令的选项以 `swarmloom <command> --help` 的输出为准。
:::

CLI 使用本机 Chrome/Chromium 逐帧播放，在虚拟时钟上捕获画面，再交给 ffmpeg 编码。它适合批量导出、固定尺寸录像和可复现构建。

## 环境与安装

从源码构建（需要 Node.js 22.12 或更高版本）：

```bash
git clone https://github.com/Boulea7/swarmloom.git
cd swarmloom
corepack enable
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install
pnpm build
node apps/cli/dist/cli.js --help
```

`pnpm build` 会把渲染页、快照脚本和 Studio 一起打包进 `apps/cli/dist/`。在源码环境中，下文的 `swarmloom` 即 `node apps/cli/dist/cli.js`。

npm 包发布后可直接运行或全局安装，届时 CLI 只需要 Node.js 20 或更高版本：

```bash
npx swarmloom render ./demo.md -o demo.mp4
npm install -g swarmloom
```

渲染还需要：

- 基于 Chromium 的浏览器：Chrome、Chromium、Edge 或 Brave。CLI 不会自行下载浏览器。推荐安装与 `playwright-core` 版本对应的 Chrome Headless Shell，不同机器渲染出的画面一致；
- ffmpeg 4 或更高版本，用于 MP4、WebM、GIF 和 WebP。PNG 序列不需要 ffmpeg。

运行 `swarmloom doctor` 检查这些依赖，并打印确切的安装命令和修复建议。

## 全局选项

| 选项 | 作用 |
| --- | --- |
| `-h, --help` | 显示全局帮助；`swarmloom <command> --help` 或 `swarmloom help <command>` 显示子命令帮助 |
| `-v, --version` | 显示 CLI 版本 |

不带参数运行时，帮助写到 stderr，退出码为 1。`--quiet` 和 `--verbose` 属于 `render` 与 `snapshot`，不是全局选项，`swarmloom --quiet ...` 会被拒绝。

## `render`

```text
swarmloom render <file|url> [options]
```

把文件或网页渲染成光标群构建过程的视频，默认带声音。画面在虚拟时钟上逐帧捕获，结果不受机器快慢影响。

### 输出

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `<file\|url>` | 必填 | 本地文件或 `http(s)` URL；路径含空格时使用引号。可用文件类型见 [`formats`](#formats) |
| `-o, --output <path>` | `<输入名>.<格式>` | 输出文件，默认写在当前目录。`png-seq` 输出到目录，默认 `<输入名>-frames`。URL 的输入名由主机名和路径最后一段组成 |
| `-f, --format <format>` | 按 `--output` 扩展名推断，否则 `mp4` | `mp4`、`webm`、`gif`、`webp` 或 `png-seq`。两者都未指定且找不到 ffmpeg 时，改为输出 `png-seq` 并给出警告 |
| `--width <px>` | `1280` | 视口宽度，CSS px，范围 16–7680 |
| `--height <px>` | `720` | 视口高度，CSS px，范围 16–7680 |
| `--scale <n>` | `1` | 每个 CSS px 对应的像素数，视频尺寸为宽高各乘以该值，范围 0.25–4；任一边不能超过 8192 px |
| `--fps <n>` | `30` | 每秒帧数，范围 1–120；第 n 帧显示第 `n * 1000 / fps` 毫秒。播放器固定每秒走 120 步，所以能整除 120 的帧率（15、24、30、60 等）拍的是同一个搭建过程，只是取帧疏密不同；25、50 这类帧率的过程会略有不同 |
| `--max-duration <s>` | `120` | 视频达到该秒数即停止，范围 1–3600（带声音时最多 600）；构建未完成时给出警告 |
| `--duration <s>` | 关闭 | 固定视频时长，范围 0.1–3600 秒（带声音时最多 600）：构建完成后继续录制收尾与完成页，未完成的构建在此截断；不能与 `--max-duration` 同用 |

各格式的编码：`mp4` 为 H.264 + AAC，`webm` 为 VP9 + Opus，`gif` 和 `webp` 为无声动画。`png-seq` 写入不存在或为空的目录，帧文件从 `frame-000001.png` 开始编号，声音另存为 `audio.wav`（`--no-sound` 时不写）。

### 光标群

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--agents <n\|auto>` | `auto` | 光标数量，1–256；`auto` 按场景调整 |
| `--speed <n>` | `1` | 构建速度倍率，范围 0.05–16 |
| `--seed <n>` | `1` | 随机种子，范围 0–4294967295；相同输入、配置和种子得到相同视频 |
| `--theme <theme>` | `auto` | `auto`、`light` 或 `dark` |
| `--labels <mode>` | `names` | `names`、`agents`、`roles` 或 `none`（`none` 同时隐藏状态泡，如 “running”） |
| `--overlays <level>` | `full` | 构建时画出的编辑标记。`minimal` 不画尺寸角标、间距标注、参考线和标尺；`none` 再去掉选框、占位框、钢笔线、插入符和状态气泡，只留光标、名牌和内容 |
| `--finale <finale>` | `flock` | `flock`、`halo` 或 `none` |
| `--follow <mode>` | `tour` | `tour` 随构建滚动页面；`none` 不滚动 |
| `--opening <time>` | 关闭 | 先显示完成后的页面或文档 `<time>`（秒、毫秒或拍数，写法同 `--cue`；最长 60 秒），再淡出到空白画布并开始构建。淡出正好从 `<time>` 开始，历时 0.52 秒 |
| `--intro <style>` | `warp` | `warp`：光标围着文件图标穿梭后散开；`outline`：最多三个光标（`--agents` 更少时按其数量）先画视野内最大的形状，每个光标两个，其余光标随后加入补细节；`none`：不要开场 |
| `--tail <ms>` | `2500`（加 `--live-top` 时 `3700`） | 构建完成后的停留时间，范围 0–60000 毫秒：先是收尾动画，随后页面 go live，光标离场，页面自己的动画（CSS、SVG SMIL、Lottie）按视频时间继续播放；HTML 文档换成真实页面，页面里的动图停在第一帧。停留时间结束时 go live 还没完成（光标还在离场或仍在滑回顶部）的，视频延续到页面出现为止 |
| `--no-live` | go live | 整个停留时间都保持收尾动画，不 go live |
| `--live-top` | 关闭 | go live 时一边让光标离开，一边滑回页面顶部（最长 1.2 秒），live 页面从首屏开始 |
| `--locale <tag>` | `en-US` | 工具栏文字和页面的语言，BCP 47 标签，例如 `zh-CN` |
| `--bpm <n>` | `112` | 放置音符、散开音与完成和弦对齐的速度（八分音符网格），范围 40–240 |
| `--beat-sync <set>` | `notes` | `notes` 或 `all`。`all` 时按键、点击、吸附和钢笔锚点也落到最近的十六分音符（最多提前 30 ms 或推后 60 ms，每种声音每个十六分音符一次），离得更远的不发声 |
| `--cue <at>:<action>` | 无 | 在固定视频时间执行播放器动作，可重复。`<at>` 为秒（`12.5`）、毫秒（`12500ms`）或按 `--bpm` 计的拍数（`26b`，需要显式给出 `--bpm`）；`<action>` 为 `pause`（全部光标停住）、`resume`、`finish`（快速完成构建）、`live`（在这一刻进入 live，不再等终场稳定后自动进入；`--no-live` 时也生效；未完成的构建一次补全）或 `speed=<n>`（从这一刻起的构建速度，0.05–16；例如 `--cue 0:speed=2 --cue 17b:speed=1` 只加快开头）。在不早于 `<at>` 的第一个引擎步（1/120 秒）生效，与帧率无关，从不早于 `<at>` 的第一帧起可见；同一时间的动作按给出顺序执行；`<at>` 必须早于视频结尾 |
| `--no-sound` | 带声音 | 不输出音轨；GIF 和 WebP 本身没有音轨 |
| `--no-remote` | 加载 | 不加载输入引用的 `https:` 图片和字体。其他站点的脚本、样式表、数据请求和 `http:` 文件始终不加载 |
| `--terminal-font <mode>` | `fit` | 终端录像（`.cast`）的字号。`fit` 用 14 px，放不下时缩小；`fill` 放大字号，直到窗口填满画面宽度或高度（窗口边框不放大）。画面本来就会把较小的窗口最多放大到 2 倍，所以 `fill` 主要对列数、行数都少的短会话有用 |

### 录制证据

用于可复核、可重复的录制。三个文件与 `--output` 必须是不同的文件，且都不能是输入文件（经链接指向也不行）。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--audio-out <file>` | 关闭 | 另写一份音轨 WAV（48 kHz 立体声，与视频等长）；需要声音，不能与 `--no-sound`、GIF 或 WebP 同用 |
| `--events-out <file>` | 关闭 | 另写一份声音事件日志 JSON：引擎毫秒、与帧同一时钟，并附每个事件的帧号和配乐中实际发声的时刻 `at`（按拍对齐后的时刻；不发声为 `null`）。`scrolls` 在同一时钟上列出每段滚动（巡航、`--live-top` 的回滑）：`t` 和 `end` 及其帧号 `frame`、`endFrame`，以及视图上沿的 `from` 和 `to`（页面 CSS 像素） |
| `--manifest-out <file>` | 关闭 | 写出录制清单 JSON：参数、输入与 blueprint 的 SHA-256（blueprint 里每次运行都会变的地址，如输入的服务路径、相对渲染页解析出的链接和 `blob:` URL，先换成固定写法再求哈希）、播放器设置、cue、浏览器/ffmpeg/Node 版本、使用的字体、每帧与声音日志的 SHA-256；此时帧按 PNG 截取，哈希对应精确像素。清单可直接分享：参数和输出里的文件路径都相对清单所在目录记录（既不在该目录内、也不在其上级目录中的文件只记文件名），程序只记文件名，不记工作目录，URL 的用户信息、查询串和片段写作 `redacted` |

### 程序与日志

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--chrome <path>` | 自动探测 | Chrome/Chromium/Edge/Brave 可执行文件，探测顺序见 [`doctor`](#doctor) |
| `--ffmpeg <path>` | 自动探测 | ffmpeg 4+ 可执行文件 |
| `--require-sandbox` | 关闭 | 浏览器沙箱起不来时（以 root 运行，或关闭了 user namespace，许多容器都是这样）直接失败，而不是不带沙箱运行浏览器 |
| `-q, --quiet` | 关闭 | 只输出错误，不显示进度、警告和结果摘要。浏览器不带沙箱运行时的警告仍会显示 |
| `--verbose` | 关闭 | 把渲染页的控制台输出和每个被拦截的请求写到 stderr |

### 示例

导出 1280×720、30 fps 的 MP4：

```bash
swarmloom render ./README.md -o readme.mp4
```

不指定 `-o` 时，下面的命令写出当前目录下的 `README.mp4`：

```bash
swarmloom render ./examples/README.md
```

导出无声音、固定种子的 WebM：

```bash
swarmloom render https://example.com -o site.webm --seed 42 --no-sound
```

导出 15 fps、960×540 的 GIF：

```bash
swarmloom render ./deck.pptx -o deck.gif --fps 15 --width 960 --height 540
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

固定 24 秒、在第 26 拍停住、第 28 拍完成，并留下可复核的录制证据：

```bash
swarmloom render ./logo.svg -o take.mp4 --duration 24 --bpm 90 \
  --cue 26b:pause --cue 28b:resume --cue 28b:finish \
  --audio-out take.wav --events-out events.json --manifest-out manifest.json
```

## `snapshot`

```text
swarmloom snapshot <url|file.html> [options]
```

把网页捕获为 Blueprint JSON，供播放器、`<swarm-loom>` 和 Studio 回放，也可用于检查图层或开发适配器。文档、图片等其他文件请使用 `render`。

本地 HTML 文件按不受信内容处理：

- 页面自己的脚本不运行，捕获的是 HTML 和 CSS 本身的样子；
- 只提供该文件和它旁边（含子目录）的图片、字体、样式表、音视频等资源，范围与 `render` 相同。同目录的其他文件、点文件（如 `.env`），以及指向目录外或指向这类文件的符号链接不会提供；
- 其他站点只加载 `https:` 图片和字体，其余请求一律拦截，结束时提示拦截数量，`--verbose` 会逐条列出。

网页 URL 照常运行页面脚本。

捕获前，页面先整体滚动一遍，让懒加载内容加载、滚动触发的入场效果开始；随后页面的 CSS 动画和过渡停在固定姿态：有限的停在终点，无限循环的停在半个周期处，所以同一页面两次捕获结果相同。正在播放或设了 autoplay 的视频也这样暂停：循环的停在中间，其余的停在结尾（服务器不支持 Range 请求时停在第一帧）。`render` 渲染 URL 时也这样捕获。此后才开始的动画和脚本驱动的动画按原样捕获。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `<url\|file.html>` | 必填 | `http(s)` URL，或本地 `.html`、`.htm`、`.xhtml` 文件 |
| `-o, --output <file>` | `blueprint.json` | 输出文件；`-` 表示写到 stdout |
| `--width <px>` | `1280` | 视口宽度，CSS px，范围 16–7680 |
| `--height <px>` | `720` | 视口高度，CSS px，范围 16–7680 |
| `--chrome <path>` | 自动探测 | 浏览器可执行文件 |
| `--require-sandbox` | 关闭 | 浏览器沙箱起不来时直接失败，而不是不带沙箱运行浏览器 |
| `-q, --quiet` | 关闭 | 只输出错误。浏览器不带沙箱运行时的警告仍会显示 |
| `--verbose` | 关闭 | 把页面的控制台输出和每个被拦截的请求写到 stderr |

```bash
swarmloom snapshot https://example.com -o example.blueprint.json --width 1440
swarmloom snapshot ./examples/html/landing.html -o - > page.json
```

Blueprint 可能包含页面文字和图片引用。分享快照前应像分享原内容一样检查敏感信息。

## `serve`

```text
swarmloom serve [--port 0] [--host 127.0.0.1] [--open]
```

在本机提供随 CLI 打包的 Studio。启动后把地址写到 stdout，按 Ctrl+C 停止。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--port <n>` | `0` | 监听端口；`0` 自动选择空闲端口 |
| `--host <addr>` | `127.0.0.1` | 绑定的地址；默认只允许本机访问 |
| `--open` | 关闭 | 启动后在默认浏览器中打开 Studio |

```bash
swarmloom serve --port 4173 --open
```

绑定到非回环地址时会给出警告，因为同一网络中的其他机器可以打开 Studio。服务面向本地工作流，不要把它直接暴露为处理不受信文件的公共服务。

## `formats`

```text
swarmloom formats [--json]
```

列出可以构建的输入格式，包括名称、ID 和扩展名；最后一行是网页（`dom`），任意 `http(s)` URL 都可以作为输入。结果来自 CLI 实际打包的格式注册表，以该命令的输出为准。

```text
FORMAT                 ID        EXTENSIONS
Markdown               markdown  .md .markdown .mdown .mkd
HTML                   html      .html .htm .xhtml
…
Web page               dom       any http(s) URL
```

`--json` 输出 JSON 数组，每项包含 `id`、`label`、`extensions` 和 `mime`，适合脚本读取。

## `doctor`

```text
swarmloom doctor [--chrome <path>] [--ffmpeg <path>]
```

依次检查 Node.js 版本、浏览器能否启动、ffmpeg 版本及本机能导出的视频格式，并确认渲染页、快照脚本和 Studio 已打包。缺失项会附带修复提示。`--chrome` 和 `--ffmpeg` 用来检查指定的可执行文件，而不是自动探测到的那个。

Node.js 20+、浏览器、ffmpeg 和渲染页都可用时退出码为 0，否则为 2。缺少快照脚本或 Studio 只给出警告。

浏览器发现顺序：

1. `--chrome`；
2. `SWARMLOOM_CHROME` 环境变量；
3. Playwright 浏览器缓存中的 chromium-headless-shell（遵循 `PLAYWRIGHT_BROWSERS_PATH`）；
4. 系统安装的 Chrome、Chromium、Edge 或 Brave：`CHROME_PATH`、Linux 上 `PATH` 中的命令、各系统的默认安装位置，snap 包排在最后；
5. Playwright 的完整 Chromium 构建。

`--chrome` 或 `SWARMLOOM_CHROME` 指向的文件不存在时直接报错，不会继续探测。都找不到时，`doctor` 会提示运行 `npx playwright@<playwright-core 版本> install chromium-headless-shell`。

ffmpeg 发现顺序：

1. `--ffmpeg`；
2. `SWARMLOOM_FFMPEG` 环境变量；
3. `PATH` 中的 `ffmpeg`，低于 4 的版本会被跳过；
4. 用户自行安装的 `ffmpeg-static` 包。

CLI 不随包分发 ffmpeg，请自行安装。

```bash
SWARMLOOM_CHROME=/path/to/chromium \
SWARMLOOM_FFMPEG=/path/to/ffmpeg \
swarmloom doctor
```

## 输出与退出码

进度写到 stderr，文件数据不会混入进度输出：终端中显示带剩余时间的进度条（终端太窄时先保留百分比和剩余时间，进度条变短，帧数等字段整项省略，整行不会折行；开头的 `Rendering …` 和结尾的 `Wrote …` 两行则在字段之间换行），非终端每完成四分之一输出一行。第一次 Ctrl+C 会停止渲染、关闭浏览器、停止 ffmpeg 并删除临时文件，第二次立即退出。CLI 只结束自己启动的进程。设置 `SWARMLOOM_DEBUG=1` 后，意外错误会附带堆栈。

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 用法错误：参数无效，或输入缺失、不受支持 |
| `2` | 缺少依赖：没有浏览器、可用的 ffmpeg 或编码器，或缺少打包的页面 |
| `3` | 渲染失败：页面、浏览器或 ffmpeg 出错 |
| `130` | 被 Ctrl+C 或 SIGTERM 中断 |

## 确定性说明

CLI 固定视口、DPR、种子和帧步长。确定性来自播放器自己的虚拟时钟：每帧推进 `1000 / fps` 毫秒（播放器在其中按每秒 120 步前进，与帧率无关），等待当前帧就绪、并在页面的下一个动画帧里画出后再截图；`--scale` 不是 1、2、4 时再多等一个动画帧，这时浏览器已经光栅化了这一帧（每帧约多 17 毫秒）。不使用浏览器的 BeginFrame 控制。（在浏览器光栅化这一帧之前截图时，0.5、2.5、3 这类倍率下圆角等抗锯齿边缘可能在两次运行间差一个色阶。）声音事件离线渲染为 WAV，按视频时长补静音或截断后再合流；合流不使用 `-shortest`，因此音频和视频时长一致。

确定性验收比较原始帧与 PCM，而不是 MP4/WebM 文件字节；`--manifest-out` 记录的每帧 PNG 哈希与声音日志哈希可直接用来比较两次运行。编码器版本、线程和平台可能改变压缩字节，即使画面与声音一致。要复现结果，还应记录输入内容、CLI/适配器版本、浏览器、字体、ffmpeg 和导出参数。
