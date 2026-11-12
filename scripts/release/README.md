# 发版流程 / Release process

本目录是 `.github/workflows/release.yml` 和 `.github/workflows/extension.yml` 调用的脚本。脚本只用 Node 内置模块和
根目录的 `yaml` 开发依赖，可以在本地运行。到目前为止，还没有任何版本发布到 npm 或任何扩展商店。

These are the scripts behind `release.yml` and `extension.yml`. They need only Node built-ins and the root `yaml`
dev dependency and run locally. Nothing has been published to npm or to any extension store yet.

## 流程

1. 用户可见的改动在 PR 里附带 changeset（`pnpm changeset`，见 `.changeset/README.md`）。
2. CI 在 `main` 上通过后，`release.yml` 的 `select-mode` 判断模式：
   - 有待处理的 changeset（至少一个会升版本）：`version` job 运行 `pnpm version-packages`，把版本号和 CHANGELOG 提交到
     `changeset-release/main` 分支，并打开或更新 “chore: version packages” PR（首发前例外，见“首次发布”）。
   - 没有 changeset，但有尚未发布到 npm 的版本（Version PR 刚合并）：`pack` job 检查包元数据和依赖许可证、
     构建、生成第三方许可文件并打包；`publish` job 在 `npm` environment 中用 Trusted Publishing（OIDC）发布，推送每个包的 git tag。
   - 都没有，或者只剩空 changeset（`pnpm changeset --empty`）：什么也不做。空 changeset 由下一次 `version` job 删除。
3. 发布包含 `@swarmloom/core` 时，`assets` job 创建产品 tag `vX.Y.Z` 和 GitHub Release，附上：
   - `swarmloom-chrome-X.Y.Z.zip`、`swarmloom-edge-X.Y.Z.zip`
   - `swarmloom-firefox-X.Y.Z.zip`（桌面版和 Android 共用一个包）和 `swarmloom-firefox-source-X.Y.Z.zip`（给 AMO 审核的源码）
   - `swarmloom-safari-X.Y.Z.zip`（web 资源，用来生成 Xcode 工程）
   - `swarmloom-cli-X.Y.Z.tgz`（与 npm 上的 `swarmloom` 包相同，供离线安装：`npm install -g ./swarmloom-cli-X.Y.Z.tgz`）
   - `swarmloom-bookmarklet-X.Y.Z.zip`（书签工具安装页，与 Pages 上 `/swarmloom/bm/` 的构建相同，附 `LICENSE.md`）
   - `SHA256SUMS.txt`
   发布说明由 GitHub 按 `.github/release.yml` 的分类自动生成。手动推送 `v*` tag 或在 Actions 页面手动运行
   （输入已有的 tag）也会执行这一步。
4. `store` job 等待 `store` environment 审批，审批后校验商店文案并生成 `store-submission-X.Y.Z` artifact。
   **CI 不会向任何商店上传**，上传步骤见 `store/CHECKLIST.md`。

Safari 的 Xcode 工程由 `extension.yml` 的 `safari` job 在 macOS runner 上生成并做未签名构建（macOS 与 iOS Simulator），
产物是 `safari-xcode-project` artifact。

## 仓库所有者的一次性设置

GitHub（Settings）

- [ ] Actions → General → Workflow permissions：勾选 “Allow GitHub Actions to create and approve pull requests”，
      否则 `version` job 不能用 `GITHUB_TOKEN` 打开 Version Packages PR。
- [ ] Environments：新建 `npm`（建议设 required reviewers，deployment branches 限 `main`）和 `store`（必须设
      required reviewers）。两个 environment 都不需要任何 secret。
- [ ] 可选：用 `GITHUB_TOKEN` 打开的 PR 不会触发 CI。如果希望 Version Packages PR 自动跑 CI，创建一个 GitHub App
      （仓库权限 Contents: write、Pull requests: write，只安装到本仓库），把 Client ID 存为变量
      `RELEASE_APP_CLIENT_ID`、私钥存为 secret `RELEASE_APP_PRIVATE_KEY`。不配置时，维护者可以关闭再重新打开该 PR 来触发 CI。
- [ ] 创建标签（发布说明分类和 `ignore-for-release` 依赖它们）：
      `node scripts/release/sync-labels.mjs --repo Boulea7/swarmloom`（需要已登录且有写权限的 `gh`；先用 `--dry-run` 看一遍）。
- [ ] 可选：安装 Changesets bot，它会在缺少 changeset 的 PR 下留言提醒。

npm

- [ ] 注册 npm 组织 `swarmloom`（`@swarmloom/*` 作用域需要它），所有维护者开启 2FA。
- [ ] Trusted Publishing 只能在**已存在**的包上配置，所以每个包的第一个版本要手动发布（见下一节）。
- [ ] 之后在 npmjs.com 上对每个公开包：Settings → Trusted Publisher → GitHub Actions：
      Organization or user `Boulea7`，Repository `swarmloom`，Workflow filename `release.yml`，Environment name `npm`，
      Allowed actions 里允许直接 `npm publish`（流程用 `pnpm publish`，不走 staged publishing）。
- [ ] 新建的 trusted publisher 配置必须在 **2 天内**完成一次成功发布，否则过期，只能删掉重建。最好在准备合并
      下一个 Version Packages PR 时再配置。
- [ ] CI 发布验证可用后，把每个包的 Settings → Publishing access 设为
      “Require two-factor authentication and disallow tokens”。

说明：OIDC 令牌（`id-token: write`）只在 `publish` job 中授予，仓库里不保存任何 npm token。发布由 pnpm 完成，pnpm 自己
处理 OIDC 令牌交换；公开仓库从 GitHub 托管 runner 发布时，npm 会自动生成 provenance。npm 文档写明 Trusted Publishing
要求 npm CLI 11.5.1+ 和 Node 22.14.0+；`.nvmrc` 的 Node 22 会装到最新的 22.x。

## 首次发布（0.1.0）

各包 `package.json` 里已经是 `0.1.0`，首个版本直接发布这个版本号，不经过 `changeset version`。首发前合入的
changeset 描述的改动都已包含在 0.1.0 中。`version` job 运行的 `pnpm version-packages`（`version-packages.mjs`）先查询
npm 公共 registry：还没有任何 `@swarmloom/core` 版本时，它删除待处理的 changeset 而不升版本，所以这时的 Version
Packages PR 只删除 changeset；registry 返回 200 和 404 以外的结果时它直接失败，不猜测。`@swarmloom/core` 发布后，它就是
普通的 `changeset version`。

1. 合并 Version Packages PR（如果有）：首发前它只删除 changeset。合并后 `.changeset/` 下应只剩 `README.md` 和
   `config.json`。只剩空 changeset 时没有 Version PR，`select-mode` 也不进入发布模式，这时开一个 PR 删掉它们。
2. 确认 `node scripts/release/check-packages.mjs` 通过（作用域包必须以 public 发布：`changeset publish` 先取包内
   `publishConfig.access`，没有时取 `.changeset/config.json` 的 `"access": "public"`），`node scripts/release/check-licenses.mjs`
   和 `pnpm build && node scripts/release/third-party-notices.mjs --check` 通过。
3. `main` 上 CI 通过后，`select-mode` 没有找到待处理的 changeset，但 npm 上还没有这些版本，于是进入发布模式。
   Release 运行会在 `publish` job 等待 `npm` environment 审批（先不要批准）。
4. 在这个 `main` 提交上，由维护者在本地手动发布（`npm login`，按提示输入 2FA 验证码）：
   ```sh
   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile
   pnpm release            # pnpm build、生成第三方许可文件、changeset publish，最后删除生成的许可文件
   git push origin --tags  # changeset publish 创建的每包 tag
   tag="v$(node -p "require('./packages/core/package.json').version")"   # v0.1.0
   git tag "$tag" && git push origin "$tag"   # 触发 assets job，创建 GitHub Release
   ```
5. 拒绝或取消第 3 步里等待的 `publish` job（版本已在 npm 上，它也不会再发布任何包）。
6. 按上一节为每个包配置 trusted publisher。从下一个版本起，按正常流程用 changeset 和 CI 发布。

## 脚本一览 / Scripts

| 脚本 | 用途 |
| --- | --- |
| `build-extension.mjs` | 以 `STUDIO_TARGET=extension` 构建 Studio（输出 `apps/studio/dist-extension`），再构建所有扩展目标；`--without-studio` 只构建扩展。`pnpm build:extension` |
| `pack-extension.mjs` | 把 `apps/extension/dist/<browser>/` 打成确定性的 zip（固定时间戳、排序、去掉点文件和 source map），并检查 manifest：Firefox 必须是含 `gecko` 与 `gecko_android` 的单一包 |
| `pack-folder.mjs` | 用同样规则打包任意构建目录（书签工具安装页） |
| `check-store.mjs` | 校验 `store/` 文案长度、与扩展 `_locales` 的名称和简介一致、每个权限都有说明、图片尺寸。`pnpm check:store` |
| `check-licenses.mjs` | 依赖许可证门禁：SPDX 表达式必须符合 `license-policy.json` 的允许列表，MPL-2.0 / OFL-1.1 只允许列出的包；其他许可证（含 `BSD` 这类非 SPDX 写法）不加例外，用 `pnpm-workspace.yaml` 的 `overrides` 替换或去掉。CI 每个 PR 和 release 都会运行。`pnpm check:licenses` |
| `check-packages.mjs` | 发布前检查包元数据（发布权限、license、repository、files 等）。`pnpm check:packages` |
| `third-party-notices.mjs` | 为打包了第三方代码或资源的公开包生成根目录 `LICENSE.md`：先是本仓库的 MIT 许可，再是每个被打包依赖的完整许可和 NOTICE。npm 和 pnpm 打包时总会带上包根目录的 `LICENSE*`，`prepublishOnly` 清空 `dist/` 也不影响它。这些文件是构建产物，不提交：`pack` 和 `assets` job 以及 `pnpm release` 在打包前生成，`--clean` 删除。哪些包整体打包依赖树见脚本里的 `BUNDLES_DEPENDENCIES`；其余公开包是 tsup 库构建，只算源码引入但未声明为依赖的包和 `?raw` / `?inline` / `?url` 内联的文件。`--pages <dir>` 改为给组装好的 GitHub Pages 产物里每个应用目录写 `LICENSE.md`（官网、文档、Studio、书签工具，见 `PAGES_APPS`；构建时从磁盘读取而非 import 的包，如官网内联的 Phosphor 图标，写在 `inlined` 里；文档站不是 workspace 包，VitePress 输出到页面里的客户端依赖写在 `frameworks` 里），由 Pages 工作流在上传前运行；应用目录的 `LICENSE.md` 至少包含本仓库的 MIT 许可，书签工具没有第三方代码也照样生成。`--app <name> <dir>` 只给一个 `PAGES_APPS` 应用的构建目录写 `LICENSE.md`，`assets` job 用它在打包书签工具 ZIP 前写入 `apps/bookmarklet/dist`。MPL-2.0 依赖的许可文件里没有版权行时（Mediabunny、DOMPurify），版权行只写在每个源码文件头部，压缩构建会把它去掉，所以从 `HEADER_COPYRIGHTS` 指定的文件头读出版权行放在许可文本前。生成和 `--check`（`pnpm check:notices`，CI 构建后运行，不写文件）都会在被打包的依赖没有许可文本、MPL-2.0 依赖找不到版权行、已构建的 `dist/` 里出现未覆盖的包，或包根目录有手写的 `LICENSE.md` 时失败；`--pages` 和 `--app` 在前两种情况或缺少应用目录时失败 |
| `version-packages.mjs` | `pnpm version-packages`，`version` job 调用：npm 上还没有 `@swarmloom/core` 时删除待处理的 changeset（它们属于首发的 0.1.0），否则运行 `changeset version`。`--dry-run` 只打印 |
| `product-tag.mjs` | 从发布结果或 tag 得出产品版本 `vX.Y.Z`，并与 `packages/core/package.json` 核对 |
| `checksums.mjs` | 为发布文件写 `SHA256SUMS.txt`（`sha256sum -c` 可读） |
| `sync-labels.mjs` | 按 `labels.json` 创建或更新仓库标签（`gh label create --force`）；`--dry-run` 只打印 |

本地检查：

```sh
pnpm test:release        # node:test 单元测试
pnpm check:notices       # 第三方许可能否生成（构建后还会检查 dist/ 里打包的包都有许可）
pnpm typecheck:release   # 用 tsc 检查这些 .mjs 的 JSDoc 类型（根目录 pnpm typecheck 也会跑，CI 由此执行）
pnpm changeset status    # 下一次发版会包含什么
```
