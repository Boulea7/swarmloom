# 隐私说明 / Privacy Notice

## 中文

### 本地处理

SwarmLoom 扩展和 Studio 在用户的浏览器中完成文件解析、DOM 快照、动画播放和导出。用户打开的文件、页面内容、设置和导出结果不会上传到 SwarmLoom 服务器。

SwarmLoom 不包含广告、分析 SDK、使用统计或遥测，也不建立用户画像。除获取用户明确选择打开的远程文件或 URL，以及下文所述 HTML 内容引用的图片和字体外，SwarmLoom 不发起内容相关的网络请求。打开本地文件时不会因解析或播放而联网。

Studio 和 CLI 显示 HTML 内容时，默认加载其中引用的 `https:` 图片和字体，不发送 Referer，不运行脚本，其他请求一律禁止；可以在 Studio 设置中关闭。

设置仅保存在当前浏览器的本地存储中。用户可以通过扩展设置、浏览器站点数据管理或卸载扩展清除本地状态；已导出的文件需由用户自行删除。

### 扩展权限

| 权限                                      | 用途                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `activeTab`                               | 用户点击扩展或主动激活后，临时访问当前标签页，用于重建该页面。                               |
| `scripting`                               | 在用户激活的页面注入并运行重建脚本，关闭后恢复原页面。                                       |
| `contextMenus`                            | 提供“重建此页”“只重建选中区域”和“在 Studio 中打开”等右键入口。                               |
| `storage`                                 | 在本地保存速度、光标、主题、声音和语言等设置。                                               |
| 可选站点权限（optional host permissions） | 仅在用户选择打开链接文件时按需申请，用于获取该文件，例如 PDF、文档或图片；可在浏览器中撤销。 |

扩展不会仅因安装而读取所有标签页，也不会在未激活的页面上运行重建。可选权限不是使用基本页面重建功能的前提。

### 分享与外部内容

只有用户主动打开远程 URL 时，浏览器才会向该 URL 所在站点请求内容；该站点可能记录其自身的访问日志。用户主动分享包含内容的链接或导出文件后，接收方可以访问其中的信息，分享前请自行检查。

隐私行为发生变化时，应同步更新本文件和相关权限说明。

## English

### Local processing

The SwarmLoom extension and Studio parse files, snapshot the DOM, play animations, and create exports in the user's browser. Opened files, page content, settings, and export results are not uploaded to a SwarmLoom server.

SwarmLoom contains no advertising, analytics SDKs, usage tracking, or telemetry, and does not build user profiles. It makes no content-related network requests except to retrieve a remote file or URL that the user explicitly chooses to open, and the images and fonts of HTML content described below. Parsing or playing a local file does not require network access.

When Studio and the CLI show HTML content, they load the `https:` images and fonts it references by default, without a referrer and without running scripts; every other request is blocked. A Studio setting turns this off.

Settings are stored only in the current browser's local storage. Users can clear local state through the extension settings, the browser's site-data controls, or by uninstalling the extension. Exported files must be deleted by the user.

### Extension permissions

| Permission                | Purpose                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab`               | Temporarily access the current tab after the user clicks or activates the extension so its page can be rebuilt.                                         |
| `scripting`               | Inject and run the rebuild scripts on a page activated by the user, then restore the original page when closed.                                         |
| `contextMenus`            | Provide actions such as rebuilding the page, rebuilding only the selection, and opening content in Studio.                                              |
| `storage`                 | Save settings such as speed, cursors, theme, sound, and language locally.                                                                               |
| Optional host permissions | Requested only when needed to retrieve a linked file the user chooses to open, such as a PDF, document, or image; users can revoke them in the browser. |

Installing the extension does not give it blanket access to all tabs, and it does not run the rebuild on pages the user has not activated. Optional permissions are not required for basic page rebuilding.

### Sharing and external content

The browser contacts a remote site's server only when the user explicitly opens a URL from that site; the site may keep its own access logs. When a user shares a link containing content or an exported file, recipients can access that information, so users should review it before sharing.

This notice and the related permission descriptions must be updated whenever privacy-related behavior changes.
