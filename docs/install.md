---
title: 安装
description: 在 Chrome、Edge、Firefox、Safari、PWA、折叠屏和手表上使用 SwarmLoom。
---

# 安装

::: warning 发布状态
商店条目和签名安装包尚未发布，扩展功能仍在实现中。本页同时给出规划中的正式入口和当前源码构建方法。源码包只用于开发验证，不代表功能已经完成。
:::

## 选择入口

| 环境 | 规划入口 | 说明 |
| --- | --- | --- |
| Chrome / Edge 桌面 | Manifest V3 扩展 | 原页重建、选区重建、Studio 文件导入 |
| Brave / Opera / Vivaldi 桌面 | Chromium 扩展包 | 复用 Chrome 包，逐一做兼容验证 |
| Firefox 桌面 | Firefox MV3 扩展 | 正式安装需要 Mozilla 签名 |
| Firefox Android | 独立 Android 包 | 移动界面；使用 Android 兼容的 manifest 和 API 子集 |
| Safari macOS / iOS / iPadOS / visionOS | 容器 App 内的 Safari Web Extension | 用 Xcode 转换、签名和运行 |
| 桌面 / Android / iOS | Studio PWA | 文件、文本、URL 和示例；不能注入其他标签页 |
| 折叠屏 | 扩展或 Studio | 双屏布局是渐进增强，普通响应式布局始终可用 |
| watchOS / Wear OS | 精简播放器或导出动画 | 不提供浏览器扩展，不承诺完整 PWA 能力 |

## 构建开发包

所有浏览器共用一份源码。先构建工作区依赖，再生成扩展目录：

```bash
git clone https://github.com/Boulea7/swarmloom.git
cd swarmloom
corepack enable
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install
pnpm build
pnpm --filter @swarmloom/extension build
```

产物位于 `apps/extension/dist/`：`chrome/`、`edge/`、`firefox/` 和 `safari/`。Firefox Android 的独立产物属于规划工作，不要直接套用桌面 manifest。

## Chrome <Badge type="warning" text="开发包" />

正式版计划通过 Chrome Web Store 分发。开发包安装步骤：

1. 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择 `apps/extension/dist/chrome/`。
5. 固定 SwarmLoom 图标，打开普通网页后点击图标。

`chrome://`、Chrome Web Store、其他扩展页和内建 PDF 查看器不支持原页重建。需要打开 `file://` 页面时，必须在扩展详情中单独允许“访问文件网址”；直接把文件拖入 Studio 不需要这项权限。

## Microsoft Edge <Badge type="warning" text="开发包" />

正式版计划提交 Microsoft Edge Add-ons。开发包安装步骤：

1. 打开 `edge://extensions`。
2. 开启“开发人员模式”。
3. 选择“加载解压缩的扩展”。
4. 选择 `apps/extension/dist/edge/`。

Edge Android 的扩展安装路径仍需分别验证。未验证前，移动端只承诺 Studio PWA，不把桌面侧载方法当作消费者安装方式。

## Brave、Opera、Vivaldi <Badge type="warning" text="兼容验证中" />

这些浏览器复用 `dist/chrome/`：

- Brave：打开 `brave://extensions`，开启开发者模式并加载解压缩目录。
- Opera：打开 `opera://extensions`，开启开发者模式并加载解压缩目录。
- Vivaldi：打开 `vivaldi://extensions`，开启开发者模式并加载解压缩目录。

Chromium 同源不代表行为完全一致。权限提示、音频解锁、工具栏和导出仍需分别测试。

## Firefox 桌面 <Badge type="warning" text="临时调试" />

正式版规划为带固定 Gecko ID 的 MV3 包，并通过 AMO 签名。Release 和 Beta 版 Firefox 不能永久安装未签名 XPI。

临时加载开发目录：

1. 打开 `about:debugging#/runtime/this-firefox`。
2. 选择“临时载入附加组件”。
3. 选择 `apps/extension/dist/firefox/manifest.json`。

临时扩展会在 Firefox 重启后移除。不要用修改签名偏好的方法替代正式发布。

## Firefox Android <Badge type="warning" text="规划中" />

Android 版计划使用独立的 Android 兼容包和非持久后台页，不照搬桌面 MV3 manifest。移动端没有桌面快捷键、右键菜单和窗口管理，入口放在扩展菜单和触控工具条中。

正式安装仍需要 AMO 签名。开发验证通过 Mozilla 的 `web-ext`、ADB 和已启用调试的设备进行；在真机完成验证前，建议使用 Studio PWA。

## Safari：从源码构建 <Badge type="warning" text="规划中" />

Safari Web Extension 必须装进容器 App。不能把 Chromium 的 ZIP 直接交给 Safari。

### 准备

- macOS 和兼容版本的 Xcode。
- 在 Mac 上测试需要 Safari；在 iPhone、iPad 或 Apple Vision Pro 真机上安装需要签名。
- 真机分发、TestFlight 和 App Store 需要 Apple Developer Program。

### 生成 Xcode 工程

在仓库根目录完成扩展构建后运行：

```bash
if xcrun --find safari-web-extension-packager >/dev/null 2>&1; then
  tool=safari-web-extension-packager
else
  tool=safari-web-extension-converter
fi

xcrun "$tool" apps/extension/dist/safari \
  --project-location build/safari \
  --copy-resources --swift --no-open --no-prompt --force
```

新版 Xcode 使用 `safari-web-extension-packager`；旧版工具名为 `safari-web-extension-converter`。`--copy-resources` 会把资源复制进工程，后续修改源目录不会自动同步，需要重新打包。

### 运行到各系统

1. 在 Xcode 中打开 `build/safari/` 下生成的工程。
2. 选择开发团队，按需修改 Bundle ID，并确认容器 App 与 Safari Web Extension target 都已签名。
3. 分别选择 macOS、iOS、iPadOS 或 visionOS 的目标与设备，然后运行容器 App。模拟器可用于无签名开发构建；真机需要签名。
4. macOS：在 Safari 设置的“扩展”中启用 SwarmLoom。
5. iOS / iPadOS：在系统的 Safari 扩展设置中启用 SwarmLoom，并按提示授予当前网站权限。
6. visionOS：在系统的 Safari 扩展设置中启用。iPadOS 使用 iOS 容器流程，visionOS 使用对应 visionOS target。

移动 Safari 不支持桌面右键菜单和窗口管理。文件导入使用文件选择器、拖放或系统分享。Safari 的 `storage.sync` 不应被理解为跨设备同步。

## Studio PWA <Badge type="warning" text="规划中" />

打开 [Studio](https://boulea7.github.io/swarmloom/studio/) 后即可作为网页使用。安装是可选的；安装后能使用独立窗口和平台支持的分享、文件入口。

### 桌面 Chromium

在 Chrome 或 Edge 中打开 Studio，点击地址栏中的安装图标；没有图标时使用浏览器菜单中的“安装应用”或“将页面安装为应用”。

macOS Safari 17 及以上可使用“文件 > 添加到 Dock”。Firefox 桌面不支持通过 manifest 安装 PWA，请使用普通标签页或书签。

### Android

在 Chrome 菜单中选择“安装应用”或“添加到主屏幕”。不同浏览器可能安装 WebAPK，也可能只创建带浏览器标识的快捷方式。

已安装 PWA 在支持的浏览器中可注册系统分享目标。没有该能力时，使用复制、粘贴和文件选择。

### iOS / iPadOS

1. 在 Safari 中打开 Studio。
2. 点击“分享”。
3. 选择“添加到主屏幕”。

iOS 不使用 Chromium 的自动安装提示。添加到主屏幕后，从主屏幕图标启动可获得独立窗口。普通 Safari 扩展与主屏幕 Web App 的权限、网站数据并不通用。

## 折叠屏

不需要单独安装。Studio 规划在左右双屏时把舞台与设置分栏，在上下双屏时改为上下布局，避免按钮和关键内容跨过铰链。

Viewport Segments 目前不是跨浏览器基线。不支持时会回退到普通响应式布局。旋转或折叠不会重新播种或改变导出时间线。

## 智能手表：诚实的替代方案

手表不安装 SwarmLoom 浏览器扩展，也不承诺通用 PWA、后台播放或任意网页重建。

规划提供以下替代：

- 通过短链接打开 `?watch=1` 精简播放器；小视口只保留播放、进度和“在手机打开”。
- 默认静音，先显示静态 poster，避免圆屏角落放置关键控件。
- 复杂内容在手机或桌面生成 MP4、动画 WebP 或静态帧，再发送到手表查看。

watchOS 的网页入口通常来自信息或邮件链接；Wear OS 的浏览器和安装方式随型号与地区变化。手表播放器用于观看已生成场景，不是在手表当前网页上召唤光标群。
