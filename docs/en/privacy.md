---
title: Privacy
description: Local processing, extension permissions, remote content, sharing and microphone boundaries in SwarmLoom.
---

# Privacy

SwarmLoom is designed to parse files, snapshot the DOM, play animation and create exports in the user's browser or local CLI, without uploading content to a SwarmLoom service.

The authoritative policy is [PRIVACY.md](https://github.com/Boulea7/swarmloom/blob/main/PRIVACY.md) in the repository. This page is a practical summary.

## Local processing

| Data | Planned handling |
| --- | --- |
| Local files | Read and parsed in the browser or local CLI; not uploaded for playback |
| Current-page DOM | Snapshotted locally after the user activates the extension; not sent to SwarmLoom |
| Settings | Store preferences such as speed, theme, sound and language without building a profile |
| Export results | Generated and saved locally; the user chooses when to delete or share |
| Sound effects | Synthesised with Web Audio or offline audio, without uploading recordings |
| Usage metrics | No advertising, analytics SDKs, usage tracking or telemetry |

Opening a local file does not require content-related network requests. Initial application loading, an uncached adapter, or an explicitly selected external resource can still make ordinary resource requests. After the first visit, the hosted Studio also downloads every adapter and the video exporter in the background so they work offline. `https:` images and fonts referenced by HTML content load by default, without a referrer; a Studio setting turns this off.

## Extension permissions

| Permission | Purpose |
| --- | --- |
| `activeTab` | Temporarily access the current tab after the user clicks the icon, menu or shortcut |
| `scripting` | Inject rebuilding into an activated page and restore the original page when closed |
| `contextMenus` | Rebuild the page, rebuild a selection, or open content in Studio |
| `storage` | Save speed, cursor, theme, sound and language preferences |
| Optional host permissions | Retrieve a remote PDF, document or image only when the user chooses to open it |

Installation alone should not grant access to every tab. Basic page rebuilding does not require permanent access to all sites. Optional permissions can be revoked in browser extension settings.

Browser-provided sync, backup and site-data mechanisms follow the browser vendor's own policies. SwarmLoom does not receive those copies of your settings.

## Remote URLs and external resources

The browser contacts a remote site only when the user explicitly opens its URL. That site may keep access logs, and referenced fonts, images or model assets may cause additional requests.

Studio has no default server proxy, does not ask for cookies, and does not forward authenticated state to SwarmLoom. Cross-origin reads remain subject to CORS and browser permissions.

Visiting documentation or Studio hosted on GitHub Pages creates hosting requests governed by that provider's policies. This is distinct from uploading file contents to a SwarmLoom service.

## Shared links

Small text can be encoded in the `#d=` URL hash. A hash is normally omitted from HTTP requests to the hosting server, but it remains part of the link:

- Recipients can decode and read the content;
- Links may persist in browser history, chat logs or system sharing logs;
- Link-preview behaviour belongs to each browser or service.

`#d=` honours only playback settings (seed, speed, cursor count, labels, finale, intro, follow, showing the original first, back to the top at the end) and ignores every other field. Remote assets and volume always follow the recipient's own settings; no link can change them.

A page sent by the bookmarklet stays in memory and is never encoded into a link, because its markup can carry the page's tokens and session address.

Check for credentials, private text, unpublished material and third-party copyrighted content before sharing. Never share configuration, source or documents containing secrets.

## Microphone

The microphone is used only for optional halo reactivity. It requires explicit action and browser permission. Denial does not affect ordinary playback, synthesised sound or export.

Audio analysis calculates local level and frequency-band values for display; it is not a sign-in or telemetry feature. Revoke access through the browser's site permissions when finished.

## Storage and deletion

Clear local state through extension settings, browser site-data controls, or by uninstalling the extension. PWA caches and settings can also be cleared through site-data controls.

Exported videos, WAVs, PNG sequences, Blueprints and shared links do not disappear when site data is cleared. Delete them separately. PWAs installed through different browsers may have independent storage.

## Security reports

Use a [GitHub Issue](https://github.com/Boulea7/swarmloom/issues/new/choose) for ordinary privacy concerns. Do not disclose vulnerabilities publicly; follow the [security policy](https://github.com/Boulea7/swarmloom/blob/main/SECURITY.md) and use private reporting.
