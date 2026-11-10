# Contributing to SwarmLoom

[简体中文](CONTRIBUTING.md)

Bug fixes, format adapters, documentation, and tests are welcome. For a substantial change, open an issue first to discuss the approach and avoid duplicate work. By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

You need Node.js 22.12 or later and pnpm. Corepack is recommended for enabling the pnpm version specified by the repository.

```bash
git clone https://github.com/Boulea7/swarmloom.git
cd swarmloom
corepack enable
pnpm install
```

Common commands:

| Command             | Purpose                             |
| ------------------- | ----------------------------------- |
| `pnpm dev:studio`   | Start the Studio development server |
| `pnpm test`         | Run unit tests                      |
| `pnpm test:browser` | Run browser tests                   |
| `pnpm lint`         | Run lint checks                     |

Browser tests require a working Chromium installation. Follow the repository test configuration to install or select the browser. Before submitting, run at least the tests directly related to your change and `pnpm lint`.

## Repository layout

```text
packages/
  core/           Engine, planner, choreographies, player, and public types
  snapshot-dom/   Convert a DOM or element subtree into a Blueprint
  formats/        Format detection, adapter registry, and dynamic loading
  adapter-*/      Input format adapters
  element/        <swarm-loom> Web Component
  export/         Frame, audio, and video export
apps/
  extension/      Browser extension
  studio/         Studio PWA
  cli/            Command-line tool
docs/             Documentation site
examples/         Self-generated samples with clear licenses
```

## Adding a format adapter

1. Implement the `Adapter` interface exported by `@swarmloom/core` in an appropriate `packages/adapter-*` package. Provide `id`, an English `label`, `extensions`, `mime`, and `load(input, ctx)`; implement `sniff` when content detection is needed.
2. Return a `LoadedSource` from `load`, including a format-neutral `Blueprint`. Return `plugins` for custom rendering when needed, and release sandboxes, object URLs, or GPU resources in `dispose`. Respect `ctx.signal` and `ctx.maxLayers`; set `Blueprint.truncated` instead of silently dropping content.
3. Register the adapter in `packages/formats`, following the existing dynamic-import pattern so optional dependencies stay off the default path.
4. Add a minimal self-generated sample to `examples/`, with its source and license documented in the sample or related documentation. Do not commit files of unknown origin.
5. Add at least one focused test proving that the sample produces a valid `Blueprint` with its essential content. Cover rejection paths for invalid input; for a regression fix, keep one meaningful boundary case.
6. Update format lists, usage documentation, and relevant translations, then run the related unit tests, browser tests, and lint checks.

## Testing principles

Keep tests lean: cover the core behavior, rejection paths, and one regression boundary. Prefer small table-driven tests over exhaustive matrices, duplicate cases across files, or snapshots of every output. Keep samples small and reviewable.

## Commit style

Use [Conventional Commits](https://www.conventionalcommits.org/en/):

```text
feat(adapter-markdown): support GFM tables
fix(core): reject an invalid layer parent
docs: clarify browser test setup
```

Common types include `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, and `chore`. Each commit should express one complete intent; keep unrelated formatting or refactoring separate.

## Clean-room rule

SwarmLoom is a clean-room implementation. Do not copy, translate, or adapt code from unlicensed projects, including the original Swarm site and Swarm Rebuild. They may be used only as high-level behavioral and interaction inspiration. Do not copy their source code, cursor graphics, color palettes, or other assets. Implementations and visual assets must be original or come from a clearly licensed, compatible source with required attribution. If the license is unclear, do not use the material.

## Pull Request checklist

Before opening a PR, confirm that:

- [ ] The change has one focused theme and links to the relevant issue.
- [ ] You reviewed the diff and excluded unrelated files, credentials, and private data.
- [ ] Relevant tests and `pnpm lint` were run and listed; any skipped checks have an explanation.
- [ ] New or changed behavior has focused tests, and invalid input is not silently accepted.
- [ ] User-visible commands, configuration, UI, and format support are reflected in the documentation.
- [ ] A new adapter is registered and includes one clearly licensed sample and at least one test.
- [ ] No code or assets were copied from unlicensed projects.
- [ ] Any new network access, permission, or data-processing behavior is explained in the PR and reflected in the [privacy notice](PRIVACY.md).

Do not open a public issue for a security vulnerability. Report it privately using the [security policy](SECURITY.md).
