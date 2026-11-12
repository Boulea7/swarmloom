# 为 SwarmLoom 做贡献

[English](CONTRIBUTING.en.md)

欢迎提交缺陷修复、格式适配器、文档和测试。开始较大改动前，请先在 Issue 中说明方案，避免重复工作。参与项目即表示同意遵守 [行为准则](CODE_OF_CONDUCT.md)。

## 开发环境

需要 Node.js 22.12 或更高版本，以及 pnpm。推荐使用 Corepack 启用仓库指定版本的 pnpm。

```bash
git clone https://github.com/Boulea7/swarmloom.git
cd swarmloom
corepack enable
pnpm install
```

常用命令：

| 命令                | 用途                   |
| ------------------- | ---------------------- |
| `pnpm dev:studio`   | 启动 Studio 开发服务器 |
| `pnpm test`         | 运行单元测试           |
| `pnpm test:browser` | 运行浏览器测试         |
| `pnpm test:firefox` | 在 Firefox 运行导出测试  |
| `pnpm test:e2e`     | 运行扩展端到端测试     |
| `pnpm lint`         | 运行代码检查           |

浏览器测试需要可用的 Chromium；按仓库测试配置中的提示安装或指定浏览器。`pnpm test:firefox` 在 Firefox 中运行浏览器内导出器和帧光栅化的测试，需要 Playwright 的 Firefox（`pnpm exec playwright install firefox`），或用 `SWARMLOOM_FIREFOX` 指定。提交前至少运行与改动直接相关的测试，以及 `pnpm lint`。

CLI 的真实渲染测试（`apps/cli/test/render.test.ts`、`snapshot.test.ts`）还需要 Chrome、ffmpeg 和 `pnpm build` 产出的渲染页。本机缺少时跳过并说明原因；在 CI 下改为失败（不提供它们的作业设置 `SWARMLOOM_TEST_DEPS=optional`）。`SWARMLOOM_CHROME` 或 `SWARMLOOM_FFMPEG` 指向无效路径时始终失败。

## 仓库结构

```text
packages/
  core/           引擎、规划、编排、播放器与公共类型
  snapshot-dom/   将 DOM 或元素子树转换为 Blueprint
  formats/        格式探测、适配器注册表与动态加载
  adapter-*/      各类输入格式适配器
  element/        <swarm-loom> Web Component
  export/         逐帧、音频与视频导出
apps/
  extension/      浏览器扩展
  studio/         Studio PWA
  cli/            命令行工具
docs/             文档站
examples/         自行生成、许可清晰的格式样例
```

## 添加新的格式适配器

1. 在合适的 `packages/adapter-*` 包中实现 `@swarmloom/core` 导出的 `Adapter` 接口。提供 `id`、英文 `label`、`extensions`、`mime` 和 `load(input, ctx)`；需要格式嗅探时实现 `sniff`。
2. `load` 返回 `LoadedSource`，其中必须包含格式无关的 `Blueprint`。需要自定义渲染时返回 `plugins`，并在 `dispose` 中释放沙箱、对象 URL 或 GPU 资源。遵循 `ctx.signal` 和 `ctx.maxLayers`；内容被截断时设置 `Blueprint.truncated`，不要静默丢弃。
3. 在 `packages/formats` 中注册适配器，沿用现有的动态导入方式，避免把可选格式依赖加载到默认路径。
4. 在 `examples/` 添加一个自行生成的最小样例，并在样例或相关文档中说明来源和许可证。不要提交来路不明的文件。
5. 至少添加一个精简测试，验证样例能转换为具有关键内容的有效 `Blueprint`。非法输入应有拒绝路径测试；修复回归时保留一个有辨识度的边界用例。
6. 更新格式列表、使用说明和必要的翻译，然后运行相关单元测试、浏览器测试和代码检查。

## 测试原则

测试保持精简，覆盖核心行为、拒绝路径和一个回归边界即可。优先表驱动的小测试，不做穷举矩阵、跨文件重复用例或为所有输出建立快照。样例应小且可审查。

## 提交风格

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```text
feat(adapter-markdown): support GFM tables
fix(core): reject an invalid layer parent
docs: clarify browser test setup
```

常用类型包括 `feat`、`fix`、`docs`、`test`、`refactor`、`perf`、`build`、`ci` 和 `chore`。一个提交只表达一个完整意图；不相关的格式化或重构请分开。

## Clean-room 规则

SwarmLoom 是 clean-room 实现。不得复制、翻译或改写未获许可项目的代码，包括原始 Swarm 网站和 Swarm Rebuild；这些项目只能作为高层行为和交互灵感的来源。不要复制其源码、光标图形、配色或其他素材。实现与视觉资产必须原创，或来自许可证明确且兼容的来源，并保留所需署名。无法确认许可证时，不要使用。

## Pull Request 清单

提交 PR 前请确认：

- [ ] 改动聚焦一个主题，并关联相关 Issue。
- [ ] 已自查 diff，没有无关文件、凭据或隐私数据。
- [ ] 已运行并列出相关测试与 `pnpm lint`；未运行的检查已说明原因。
- [ ] 新增或改变行为有精简测试，非法输入不会被静默接受。
- [ ] 用户可见的命令、配置、界面和格式支持已同步更新文档。
- [ ] 新适配器已注册，并带有一个许可清晰的样例和至少一个测试。
- [ ] 未复制任何未获许可项目的代码或素材。
- [ ] 新增网络访问、权限或数据处理行为已在 PR 中明确说明，并同步更新 [隐私说明](PRIVACY.md)。

安全问题请不要公开提交 Issue，按 [安全政策](SECURITY.md) 私下报告。
