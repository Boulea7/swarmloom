# Changesets

本目录由 [Changesets](https://github.com/changesets/changesets) 使用。用户可见的改动在 PR 中附带一个 changeset，说明影响哪些包、升级级别（patch / minor / major）和一句面向用户的说明。

This folder is used by [Changesets](https://github.com/changesets/changesets). A pull request with a user-visible change adds one changeset that names the affected packages, the bump level (patch / minor / major) and a short user-facing summary.

```sh
pnpm changeset            # 新建 changeset / add a changeset
pnpm changeset --empty    # 不发版的改动（测试、内部重构）/ a change that releases nothing
pnpm changeset status     # 查看待发布内容 / show what the next release contains
```

- `@swarmloom/core`、`@swarmloom/element`、`@swarmloom/export` 和 CLI（`swarmloom`）是固定组，任何一个变化都会一起升级到同一版本。适配器各自独立发版。
  `@swarmloom/core`, `@swarmloom/element`, `@swarmloom/export` and the CLI (`swarmloom`) form a fixed group and always share one version. Adapters are versioned independently.
- 私有包（扩展、Studio、站点、书签工具）也会升级版本并写 CHANGELOG，但不发布到 npm，也不打 tag。CLI（`swarmloom`）是公开包，随固定组发布到 npm。
  Private packages (extension, Studio, site, bookmarklet) are versioned and get a CHANGELOG, but are neither published to npm nor tagged. The CLI (`swarmloom`) is public and publishes to npm with the fixed group.
- 版本 PR 和 npm 发布由 `.github/workflows/release.yml` 完成，流程见 `scripts/release/README.md`。
  The Version Packages pull request and npm publishing are handled by `.github/workflows/release.yml`; see `scripts/release/README.md`.

首个版本 0.1.0 不经过 `changeset version`：各包 `package.json` 已经是 `0.1.0`，首次发布直接发布这个版本。首发前照常为用户可见的改动写 changeset，它们描述的改动都包含在 0.1.0 中。`pnpm version-packages`（`scripts/release/version-packages.mjs`）在 npm 上还没有 `@swarmloom/core` 时不升版本，而是删除这些 changeset，所以首发前的 Version Packages PR 只删除 changeset，合并它不会把版本升到 0.1.1 或 0.2.0。流程见 `scripts/release/README.md`。
The first version, 0.1.0, skips `changeset version`: every `package.json` is already at `0.1.0` and the first release publishes it as is. Keep adding changesets for user-visible changes until then; everything they describe is part of 0.1.0. While `@swarmloom/core` is not on npm, `pnpm version-packages` (`scripts/release/version-packages.mjs`) deletes the pending changesets instead of bumping, so the Version Packages pull request before the first release only removes them and merging it never moves the packages to 0.1.1 or 0.2.0. See `scripts/release/README.md`.
