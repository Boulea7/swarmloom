# 安全政策 / Security Policy

## 中文

### 支持的版本

| 版本                             | 安全修复支持 |
| -------------------------------- | ------------ |
| `main` 分支                      | 支持         |
| 最新正式 minor 版本及其最新补丁  | 支持         |
| 更早的提交、minor 版本和补丁版本 | 不支持       |

项目尚未发布正式版本时，仅 `main` 分支属于支持范围。

### 报告漏洞

请使用 [GitHub 私密漏洞报告](https://github.com/Boulea7/swarmloom/security/advisories/new) 提交报告，不要创建公开 Issue 或 Discussion。报告请尽量包含：

- 受影响的版本、浏览器和操作系统；
- 可复现步骤或概念验证；
- 潜在影响与攻击前提；
- 如已知，建议的修复方式。

请使用虚构样例，不要附带真实用户数据。维护者会私下评估报告、确认影响并协调修复与披露；这不构成固定响应时限的承诺。

### 范围说明

浏览器扩展只在用户主动激活的页面上运行。扩展和 Studio 在本地处理内容，不把用户内容发送到 SwarmLoom 服务器，不包含遥测。与本项目相关的重要问题包括：绕过激活边界、非预期权限提升或数据外发、恶意输入文件导致的代码执行，以及隐私说明与实际行为不一致。

目标网站、浏览器或第三方依赖自身且不涉及 SwarmLoom 代码的问题，应报告给相应项目。普通缺陷请使用 [Issue 表单](https://github.com/Boulea7/swarmloom/issues/new/choose)。

## English

### Supported versions

| Version                                             | Security fixes |
| --------------------------------------------------- | -------------- |
| `main` branch                                       | Supported      |
| Latest stable minor release and its latest patch    | Supported      |
| Earlier commits, minor releases, and patch releases | Not supported  |

Until the first stable release, only the `main` branch is supported.

### Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/Boulea7/swarmloom/security/advisories/new). Do not open a public issue or Discussion. Include, where possible:

- The affected version, browser, and operating system;
- Reproduction steps or a proof of concept;
- Potential impact and attack prerequisites;
- A suggested fix, if known.

Use fictional samples and do not include real user data. Maintainers will privately assess the report, confirm its impact, and coordinate a fix and disclosure; this is not a guaranteed response-time commitment.

### Scope notes

The browser extension runs only on pages where the user explicitly activates it. The extension and Studio process content locally, do not send user content to a SwarmLoom server, and contain no telemetry. Important in-scope issues include bypassing the activation boundary, unexpected privilege escalation or data exfiltration, code execution through a malicious input file, and behavior that contradicts the privacy notice.

Issues in a target website, browser, or third-party dependency that do not involve SwarmLoom code should be reported to the respective project. For ordinary defects, use the [issue forms](https://github.com/Boulea7/swarmloom/issues/new/choose).
