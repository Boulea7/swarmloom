---
title: FAQ 与故障排查
description: 解决 SwarmLoom 的页面权限、声音、格式、性能、导出和平台问题。
---

# FAQ 与故障排查

## 页面与权限

### 点击图标没有反应？

先确认当前是普通网页。`chrome://`、浏览器商店、其他扩展页、阅读模式、`view-source:` 和内建 PDF 查看器等页面不能注入内容脚本。

改用右键或菜单中的“在 Studio 中打开”，或下载原文件后拖入 Studio。企业策略也可能限制特定站点。

### 为什么本地 `file://` 页面不能重建？

Chromium 需要单独允许扩展访问文件网址。在扩展详情中开启该权限后重试。

如果不需要原页 DOM，直接把文件拖入 Studio 更简单，也不需要文件网址权限。

### Studio 打不开一个 URL？

常见原因是 CORS、混合内容、需要登录、链接失效或服务器不允许浏览器读取。知道 URL 不等于有权读取其内容。

需要当前页面登录态时，在该页面使用扩展。不要向第三方服务提交 Cookie。公开文件也可以先下载，再本地导入。

### 内建 PDF 查看器为什么不能原地重建？

浏览器内置 PDF 查看器属于受限页面，扩展不能读取它的 DOM。选择“在 Studio 中打开”原始 PDF，或把 PDF 文件直接导入。

### PWA 离线后为什么远程示例打不开？

离线缓存只覆盖应用壳和已经缓存的模块、示例与资源。远程 URL、未使用的适配器和外部字体不会因为安装了 PWA 就自动离线可用。

先在线打开需要的格式，或改用本地文件。

## 播放与声音

### 为什么没有声音？

浏览器通常要求一次用户手势才能启动 AudioContext。点击“点按开启声音”或声音按钮，并确认：

- 工具栏声音已开启；
- 系统、标签页和 PWA 没有静音；
- 主音量不为 0；
- 使用的不是刻意关闭键盘声的音效包。

自动播放被阻止不会影响画面和导出。

### 视频、WebGL 或跨源 iframe 为什么只是截图或占位？

这些区域不一定能拆成安全的文字、盒子和路径。SwarmLoom 会使用快照或带标签的媒体层，不执行原页面脚本来伪装重建。

### 页面很长，能否只看当前部分？

使用 `follow: "scroll"` 手动控制，或在扩展中只重建选中区域。`tour` 会自动跟随构建进度，`none` 则固定视口。

### 怎样减少动画？

保留系统的“减少动态效果”偏好，并使用默认 `reducedMotion: "auto"`。该模式使用快速交叉淡化，跳过群聚和相机环绕。

## 格式与内容

### DOCX 页数或换行与 Word 不同？

浏览器 HTML 排版不是 Word 的实时分页引擎。没有可靠分页信息时，SwarmLoom 使用连续布局。

需要精确页位置时，请从 Word 导出 PDF 后导入。

### 旧版 DOC 为什么只有简化文字？

首版 DOC 管线以恢复正文和段落为目标，不承诺复杂表格、浮动图片、精确字体或分页。需要版式时请转换为 DOCX，精确展示则转换为 PDF。

### 扫描 PDF 为什么没有逐字输入？

扫描件通常只有页面图像，没有文本项。SwarmLoom 会按区域扫入，不伪造文字层。首版不自动执行 OCR。

### 表格公式结果为什么为空或显示表达式？

SwarmLoom 不执行公式，只展示文件内表达式和缓存结果。请用对应电子表格软件重新计算并保存，再导入。宏、外链和网络查询不会运行。

### OBJ 或 glTF 为什么提示缺资源？

OBJ 可能需要 MTL 与贴图，`.gltf` 可能需要外部 `.bin` 和纹理。请保留原始相对路径并一起提供资源。希望单文件分发时优先使用 GLB。

## 性能与导出

### 播放卡顿时先改什么？

把光标数改为 `auto` 或更低值，关闭光环结尾，降低视口与 DPR，并检查超大图片和模型。详细步骤见[性能](./performance)。

提高速度只缩短时长，不一定降低每帧开销。

### 浏览器里没有导出按钮或录制失败？

浏览器可能不支持 Region Capture 或所需的 MediaRecorder 能力。使用 Studio 给出的 CLI 命令，不要依赖截图拼视频。

### CLI 找不到 Chrome 或 ffmpeg？

先运行：

```bash
swarmloom doctor
```

然后显式指定：

```bash
swarmloom render ./demo.md -o demo.mp4 \
  --chrome /path/to/chromium \
  --ffmpeg /path/to/ffmpeg
```

也可以使用 `SWARMLOOM_CHROME` 和 `SWARMLOOM_FFMPEG` 环境变量。当前 CLI 子命令仍在实现中，上述是规划接口。

### 相同种子为什么压缩文件字节仍不同？

编码器版本、线程和平台可能改变 MP4/WebM 字节。确定性验收比较原始帧和 PCM，不比较压缩文件哈希。

还要固定输入、浏览器、字体、视口、DPR、适配器、插件和 CLI 版本。

### 能否在手表上安装扩展或完整 Studio？

不能承诺。watchOS/Wear OS 不提供通用 SwarmLoom 扩展入口。规划替代是 `?watch=1` 精简播放页，或在其他设备导出 MP4、动画 WebP 和静态帧。

## Safari

### 为什么不能直接把 ZIP 装进 Safari？

Safari Web Extension 必须位于容器 App 中。按[安装指南](./install#safari-从源码构建)用 Xcode 生成、签名并运行对应系统的 App。

### 未签名扩展为什么重启后消失？

macOS Safari 的未签名扩展许可通常只是临时开发路径。正式使用需要合适签名；店外 macOS 分发还涉及 Developer ID 与公证，TestFlight/App Store 需要 Apple Developer Program。

## 仍然无法解决？

先搜索 [GitHub Issues](https://github.com/Boulea7/swarmloom/issues) 和 [Discussions](https://github.com/Boulea7/swarmloom/discussions)。提交新问题时附上：

- SwarmLoom、浏览器和操作系统版本；
- 输入格式与脱敏最小样例；
- 完整操作步骤；
- 预期和实际结果；
- 控制台错误、截图或短录屏。

不要上传密码、Cookie、私人文档或其他敏感数据。安全漏洞请走[私密安全报告](https://github.com/Boulea7/swarmloom/blob/main/SECURITY.md)。
