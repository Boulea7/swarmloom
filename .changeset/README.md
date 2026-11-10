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
- 私有包（扩展、Studio、未发布的 CLI）也会升级版本并写 CHANGELOG，但不打 npm tag。
  Private packages (extension, Studio, the CLI while unpublished) are versioned and get a CHANGELOG, but no npm tag.
- 版本 PR 和 npm 发布由 `.github/workflows/release.yml` 完成，流程见 `scripts/release/README.md`。
  The Version Packages pull request and npm publishing are handled by `.github/workflows/release.yml`; see `scripts/release/README.md`.

`initial-release.md` 描述首个版本 0.1.0。它假定各包在第一次 `changeset version` 前的版本号是 `0.0.0`（minor 升级得到 0.1.0）；如果仍是 `0.1.0`，会得到 0.2.0。
`initial-release.md` describes the first version, 0.1.0. It assumes every package is at `0.0.0` before the first `changeset version` (a minor bump gives 0.1.0); packages still at `0.1.0` would become 0.2.0.
