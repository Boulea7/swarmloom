---
title: 性能基准
description: pnpm bench 的场景、预算与最近一次结果。
---

# 性能基准

`pnpm bench` 在无头 Chromium 中播放 demo 页和一个约 4400 图层的合成页，记录快照耗时、构建帧率、每帧脚本开销、长任务、舞台节点数和堆内存，并与 `scripts/bench/lib.mjs` 里的预算比较。设计目标见[性能](./performance.md)。

## 最近一次结果

下表由 `node scripts/bench.mjs --write` 生成。它是一台共享 Linux 机器上的单次结果，只用于发现回归，不代表所有设备。

<!-- bench:start -->
| 场景 | 图层 | 光标 | 快照 | 构建 fps | rAF 回调 均值 / p95 / 最大 | >33 ms 帧 | 长任务 | 舞台节点 | 堆内存 |
|---|---|---|---|---|---|---|---|---|---|
| demo 页 | 197 | 37 | 50 ms | 60.0 | 0.79 / 1.90 / 8.3 ms | 0 | 0 / 0 ms | — | 4.0 → 构建后 5.0 → 3 次重播后 5.2 MB |
| 合成 4k 图层页（前 8 s，随后 finish()） | 4412 | 64 | 235 ms | 59.9 | 1.90 / 4.40 / 7.3 ms | 1 | 0 / 0 ms | 构建中峰值 868，finish() 期间峰值 1101 | finish 后 6.6 MB |
| 128 光标群聚结尾 | 197 | 128 | — | 60.0 | 0.60 / 1.20 / 2.7 ms | 0 | 0 / 0 ms | — | — |

环境：Chrome 150.0.7871.46，无头，1280x800，DPR 1，关闭声音，64 核，1 分钟负载 7.7，2026-11-11。seek(10 s) 从头重放 75 ms。

预算：满足 17/18；未满足：4k layers: longest task while snapshotting, ms 235.0 (<= 120)。
<!-- bench:end -->

未满足的是 4k 图层页的快照长任务：`@swarmloom/snapshot-dom` 目前在一个任务里遍历整页，这台机器上约 200–250 ms，页面已完成布局、快照连跑三次时也一样。遍历改成 8–12 ms 的时间片后，这个预算才能满足。

- **rAF 回调**：每帧所有 `requestAnimationFrame` 回调的脚本耗时之和。
- **舞台节点**：播放器隔离舞台中挂载的元素数。
- **堆内存**：强制 GC 后的 JS 已用堆，包含基准脚本加载的引擎代码。

## 场景

脚本用 esbuild 从源码打包引擎和 DOM 快照，在 1280×800、DPR 1、关闭声音的条件下依次运行：

- **demo 页**：`examples/web/demo.html`。快照后以 `agents: "auto"`、种子 1 完整构建，再以 3 倍速重播 3 次看堆是否增长，最后计时 `seek(10 s)`。
- **合成 4k 图层页**：980 张卡片，约 4400 个图层。测量前 8 s 的构建，然后调用 `finish()` 完成，统计挂载节点。
- **128 光标群聚**：demo 页 128 个光标，`finish()` 进入群聚结尾后让指针扫动 3 s。

上表最后一行同时打印参考产品在其自身 demo 页上的一次观测值（不同页面、机器和方法），只作对照，不参与判定。

## 预算

预算刻意放宽，用来发现结构性回归：快照变成一个长任务、`finish()` 一次挂载全部图层、重播泄漏内存、单帧开销翻倍。它们不是设计目标。任一预算不满足时 `pnpm bench` 以退出码 1 结束。

计时类预算假设没有其他进程争用 CPU，请在空闲机器上单独运行。

## 命令

```bash
pnpm bench                                   # 运行三个场景并检查预算
node scripts/bench.mjs --report-only         # 只打印结果，不因预算失败退出
node scripts/bench.mjs --write               # 把结果表写入本页和英文页
node scripts/bench.mjs --json bench.json     # 另存原始结果
node scripts/bench.mjs --json > bench.json   # 原始结果写到 stdout，可读报告写到 stderr
node scripts/bench.mjs --chrome /path/to/chromium
```

浏览器依次取 `--chrome`、`$SWARMLOOM_CHROME`、`~/bin/chromium`，最后是 Playwright 自带的 Chromium。预算与表格逻辑的单元测试：`pnpm test:bench`。
