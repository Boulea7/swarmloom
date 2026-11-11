---
title: 致谢与许可
description: SwarmLoom 的灵感来源、clean-room 声明、品牌与第三方许可。
---

# 致谢与许可

## 灵感来源

SwarmLoom 的多光标重建概念受到以下作品启发：

- **Joel Califa 的 Swarm 网站**：让人们看到多个光标协作构建界面这一创意。
- **Dhvanil Patel 的 Swarm Rebuild 扩展**：展示了把这一交互带入浏览器扩展的方向。
- **HaloFlux**：为规划中的音频响应光环结尾提供高层灵感。

感谢这些作者让相关交互创意被更多人看到。SwarmLoom 的多格式适配、确定性引擎、插件架构、跨平台壳、离线音频与视频管线是独立设计和实现的。

## Clean-room 声明

上述 Swarm 与 Swarm Rebuild 项目没有为我们的实现提供可复用的开源许可。SwarmLoom 因而采用 clean-room 方式：

- 不复制、翻译或改写其源码；
- 不复用其光标图形、配色、标签样式、声音或其他素材；
- 实现只依据高层行为说明、公开平台能力和独立技术设计；
- 第三方代码与素材只有在许可明确且兼容时才采用，并保留必要声明。

SwarmLoom 的光标矢量、Loom Indigo `#5B5BF7`、测量 Accent `#FF4F7B`、光标色板、名称标签与合成音效设计均为原创。

“受启发”不表示上述作者背书、参与或许可了 SwarmLoom。

## SwarmLoom 许可

SwarmLoom 源码以 [MIT License](https://github.com/Boulea7/swarmloom/blob/main/LICENSE) 发布。文档、原创图标与示例如另有说明，以对应文件旁的声明为准。

## 当前文档与开发工具

以下版本来自当前工作区安装结果；许可证来自各包的 `package.json`。它们用于文档、类型检查和测试，不等于全部会被打包进浏览器播放器。

| 项目 | 当前版本 | 许可证 |
| --- | --- | --- |
| [VitePress](https://vitepress.dev/) | 1.6.4 | MIT |
| [Vue](https://vuejs.org/) | 3.5.45 | MIT |
| [Vite](https://vite.dev/) | 8.3.6 | MIT |
| [Shiki](https://shiki.style/) | 2.5.0 | MIT |
| [MiniSearch](https://lucaong.github.io/minisearch/) | 7.2.0 | MIT |
| [TypeScript](https://www.typescriptlang.org/) | 6.0.3 | Apache-2.0 |
| [Playwright](https://playwright.dev/) | 1.65.0 | Apache-2.0 |
| [Vitest](https://vitest.dev/) | 5.1.0 | MIT |
| [Biome](https://biomejs.dev/) | 2.6.6 | MIT OR Apache-2.0 |

## 规划中的格式依赖

下列库是研究后选定的主要实现路线，尚未全部进入当前依赖树。实际发布以各包 manifest、锁文件和发行包中的第三方声明为准。

| 项目 | 规划用途 | 许可证 / 采用分支 |
| --- | --- | --- |
| unified / remark-parse / remark-gfm / remark-math | Markdown AST | MIT |
| docx-preview | DOCX 样式优先导入 | Apache-2.0 |
| Mammoth | DOCX 语义导入 | BSD-2-Clause |
| PDF.js | PDF 文本、绘制信息与页面位图 | Apache-2.0 |
| three.js | glTF、OBJ、STL、PLY 与 WebGL 舞台 | MIT；随附的 Draco 解码器为 Apache-2.0，meshoptimizer 解码器为 MIT |
| SheetJS Community Edition | 工作簿读取 | Apache-2.0；不使用独立许可的 Pro |
| Papa Parse | CSV / TSV | MIT |
| cfb | 旧版 DOC 的 Compound File Binary 读取 | Apache-2.0 |
| word-extractor | Node 旧版 DOC 文本提取 | MIT |
| fflate | ZIP 与压缩数据 | MIT |
| KaTeX | 数学排版，按需加载 | MIT |
| Mermaid | 图表编译，按需加载 | MIT |
| highlight.js | 源码高亮 | BSD-3-Clause |
| DOMPurify | 不受信 HTML 清洗 | 采用 Apache-2.0 分支 |

双许可依赖按表中明确选择的分支使用。大型解码器、字体、样例和媒体还需要单独审查其资源许可，不能只依据顶层 npm `license` 字段。

## 素材与示例

仓库示例应优先自行生成，或使用许可清晰的素材。新增第三方样例时，应记录作者、来源、许可证和必要署名；不提交来源不明的文档、字体、图片、音频或模型。

发布产物需要保留完整的第三方许可与 NOTICE。打包了第三方代码或资源的 npm 包（例如 CLI、`@swarmloom/element` 的 CDN 构建、KaTeX 字体内联的 Markdown 适配器）在包根目录附带 `LICENSE.md`，其中先是 SwarmLoom 的 MIT 许可，再是每个被打包依赖的完整许可与 NOTICE；它由 `scripts/release/third-party-notices.mjs` 在打包发布时生成，不提交到仓库；CI 会检查每个被打包的依赖都有许可文本。官网随 Bricolage Grotesque 字体一起部署 `fonts/OFL.txt`；GitHub Pages 上的官网和 Studio 目录各有一份同样格式的 `LICENSE.md`，列出该应用打包或内联的全部第三方包（如官网的 Phosphor 图标、Studio 的 lottie-web），由同一脚本在部署时生成。若发现遗漏，请通过 [GitHub Issue](https://github.com/Boulea7/swarmloom/issues/new/choose) 提供包名、版本和相关文件路径。
