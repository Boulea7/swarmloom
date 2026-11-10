# 商店提交清单 / Store submission checklist

SwarmLoom 目前**没有**在任何商店上架。本清单记录首次和后续人工提交的步骤。CI 不会向任何商店上传：`release.yml` 的
`store` job 在 `store` environment 审批通过后，只校验文案并打包一份 `store-submission-<version>` artifact，
由维护者手工上传。

费用、审核时间和表单字段摘自各商店官方文档（2026-11-10 查阅），商店会调整，提交时以后台实际显示为准，
并把变化写回本文件和 `store/stores.yaml`。

## 0. 每次提交前

- [ ] 从 GitHub Release 或 `store-submission-<version>` artifact 取得本次的包，用 `SHA256SUMS.txt` 核对。
- [ ] 每个商店都要求新版本号大于已上传的版本；同一版本不能重复上传。
- [ ] `node scripts/release/check-store.mjs --extension <解压后的 chrome 包> --require-images` 无错误。
- [ ] 对照本次构建逐条核对 `store/listing/en.yaml` 与 `zh-CN.yaml`：功能、快捷键（Alt+Shift+W）、右键菜单、
      权限。没有实现的内容不写。
- [ ] `PRIVACY.md` 与权限说明一致，隐私政策链接可公开访问（`store/stores.yaml` 中的 `urls.privacy_policy`）。
- [ ] 在真实浏览器里装上这个包跑一遍审核备注（`reviewer_notes`）里的步骤。

## 1. Chrome Web Store

账号（一次性）

- [ ] Google 账号开启两步验证（发布和更新都强制要求）。
- [ ] 在开发者控制台（https://chrome.google.com/webstore/devconsole）同意开发者协议，支付**一次性注册费**
      （金额以注册页显示为准）。
- [ ] 填写开发者邮箱并验证；按实际情况声明是否为“交易者（trader）”（欧盟法规要求，交易者需公开联系信息）。

提交

- [ ] 上传 `swarmloom-chrome-<version>.zip`。名称、简介和图标来自 manifest，后台不能改。
- [ ] Store listing：详细描述（`description`，各语言）、类别（`stores.yaml`）、语言、截图 1–5 张 1280x800、
      小宣传图 440x280（必填）、大宣传图 1400x560（可选）、主页和支持链接。
- [ ] Privacy practices：单一用途（`privacy.single_purpose`）、每个权限的理由（`privacy.permissions`）、
      远程代码选“No”、数据类型和三项声明（`stores.yaml` 的 `chrome.privacy`）、隐私政策链接。
- [ ] Distribution：公开、全部地区；首次提交建议关闭“审核通过后自动发布”，通过后再手动发布。
- [ ] 审核时间：官方说明多数在 24 小时内、超过 90% 在 3 天内完成（2021 年初的数据）；
      超过 3 周未完成可联系开发者支持。

## 2. Microsoft Edge Add-ons

账号（一次性）

- [ ] 用 Microsoft 账号在 Partner Center 注册 Microsoft Edge 计划（**不收注册费**）。

提交（https://partner.microsoft.com/dashboard/microsoftedge/overview）

- [ ] 上传 `swarmloom-edge-<version>.zip`（与 Chrome 包同源）。名称和简介来自 manifest。
- [ ] Availability：公开、市场。Properties：类别、隐私政策链接、网站、支持联系方式。
- [ ] Store listings（每种语言）：描述（至少 250 个字符）、商店 logo 300x300（必填）、小/大宣传图（可选）、
      截图最多 6 张 1280x800、搜索词（`search_terms`）。
- [ ] 权限理由与远程代码声明同 Chrome；认证备注填 `reviewer_notes`。
- [ ] 审核时间：官方说明认证最长约 7 个工作日。

## 3. Firefox Add-ons（AMO）

账号（一次性）

- [ ] 用 Mozilla 账号登录 https://addons.mozilla.org/developers/，接受附加组件政策和开发者协议。不收费。

提交

- [ ] 选择 “On this site”（公开 listing）。上传 `swarmloom-firefox-<version>.zip`：一个包同时支持桌面版和
      Firefox for Android，两个平台都勾选。不要再上传单独的 Android 包。
- [ ] 源代码：代码经过打包，必须选择提交源码，上传 `swarmloom-firefox-source-<version>.zip`（上限 200 MB）。
      构建步骤在压缩包内的 `README-AMO.md`（来源：`store/README-AMO.md`）。
- [ ] 描述页：摘要（`summary`，不含网址）、描述、Firefox 和 Firefox for Android 各最多 2 个类别、
      支持网站、许可证 MIT。扩展不向外传输数据（manifest 声明 `data_collection_permissions: none`），
      隐私政策不是必填项，仍建议链接 `PRIVACY.md`。审核备注填 `reviewer_notes`。
- [ ] 截图：使用 1280x800 的同一组截图。
- [ ] 审核时间：自动验证后签名并发布，官方说明最长 24 小时；被抽中人工审核时更长，上架后也可能被人工复审。

## 4. Safari（Mac App Store 与 iOS/iPadOS App Store）

Safari 扩展不能以 zip 发布，必须作为一个宿主 App 里的 app extension 上架。

账号与工具（一次性）

- [ ] 加入 Apple Developer Program（**年费 99 美元**，以 Apple 页面为准）。免费账号不能上架。
- [ ] 一台装有最新 Xcode 的 Mac；或使用 App Store Connect 的网页版 packager（仍需开发者计划，按 Xcode Cloud 时长计算）。
- [ ] 在 App Store Connect 创建 App 记录（Bundle ID `io.github.boulea7.swarmloom`，平台 macOS 与 iOS），
      在 Certificates, Identifiers & Profiles 中注册 App 和扩展两个 Bundle ID。

生成并签名

- [ ] 用 `swarmloom-safari-<version>.zip`（web 资源）生成工程：解压到 `apps/extension/dist/safari` 后运行
      `bash apps/extension/scripts/safari-package.sh --app-name SwarmLoom --bundle-identifier io.github.boulea7.swarmloom`；
      也可以直接下载 `extension.yml` 的 `safari-xcode-project` artifact（未签名）。
- [ ] 宿主 App：补齐 App 图标（`assets/brand/`），界面只需说明如何在 Safari 设置中启用扩展；不要放与扩展无关的功能。
- [ ] Xcode 中为 App 和扩展 target 选择团队，启用自动签名；版本号与 manifest 一致。
- [ ] 先在真实 macOS Safari 和至少一台 iPhone 或 iPad（TestFlight）上跑审核备注里的步骤。
- [ ] 分别 Archive macOS 与 iOS 两个 scheme，Validate 后 Distribute 到 App Store Connect。

App Store Connect

- [ ] 名称（`name`，2–30 字符）、副标题（`subtitle`）、推广文本、关键词、描述、支持 URL、营销 URL（主页）、
      隐私政策 URL、版权（`stores.yaml`）、类别。
- [ ] App 隐私：“不收集数据”（Data Not Collected）。处理只在设备上进行。
- [ ] 截图：Mac 1280x800；iPhone、iPad 尺寸见 `store/images/README.md`。截图不能带 alpha 通道。
- [ ] App Review 备注填 `reviewer_notes`，说明需要先在 Safari 设置中启用扩展。
- [ ] 审核时间：Apple 说明通常至少 50% 在 24 小时内、90% 在 48 小时内完成。

## 5. 上架之后

- [ ] 商店链接真实可用后，再把它们加入 README、文档和徽章；在此之前不写“已上架”。
- [ ] 在 GitHub Release 说明中注明各商店的审核状态；审核被拒时记录原因和处理办法。
