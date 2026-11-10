## 变更说明 / Summary

<!-- 简要说明问题、方案和主要改动。 / Briefly describe the problem, approach, and main changes. -->

## 关联 Issue / Related issues

<!-- 例如 / Example: Closes #123 -->

## 验证 / Verification

<!-- 列出实际运行的命令和结果；未运行的相关检查请说明原因。 / List the commands and results. Explain any relevant checks that were not run. -->

```text
pnpm test
pnpm test:browser
pnpm lint
```

## 清单 / Checklist

- [ ] 改动聚焦一个主题，并已关联相关 Issue。 / The change has one focused theme and links to the relevant issue.
- [ ] 已自查 diff，没有无关文件、凭据、私人数据或不必要的生成产物。 / I reviewed the diff and excluded unrelated files, credentials, private data, and unnecessary generated artifacts.
- [ ] 核心行为、拒绝路径和必要的一个回归边界有精简测试。 / Focused tests cover the core behavior, rejection paths, and one regression boundary where needed.
- [ ] 已运行相关单元测试；浏览器行为变更已运行 `pnpm test:browser`。 / Relevant unit tests were run; browser behavior changes were checked with `pnpm test:browser`.
- [ ] 已运行 `pnpm lint`，或说明未运行的原因。 / `pnpm lint` was run, or the reason for skipping it is explained.
- [ ] 用户可见的命令、配置、界面和格式支持已同步更新文档与翻译。 / User-visible commands, configuration, UI, and format support have updated documentation and translations.
- [ ] 新格式适配器已注册，并包含一个许可清晰的生成样例和至少一个测试。 / A new format adapter is registered and includes one clearly licensed generated sample and at least one test.
- [ ] 遵守 clean-room 规则，未复制未获许可项目的代码、图形或其他素材。 / The clean-room rule is followed; no code, graphics, or other assets were copied from unlicensed projects.
- [ ] 新增网络访问、权限或数据处理行为已说明，并更新 `SECURITY.md` 或 `PRIVACY.md`（如适用）。 / New network access, permissions, or data processing is explained and reflected in `SECURITY.md` or `PRIVACY.md` where applicable.
- [ ] 截图、录屏和样例不包含敏感信息。 / Screenshots, recordings, and samples contain no sensitive information.
