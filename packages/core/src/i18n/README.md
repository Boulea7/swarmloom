# src/i18n

Owner: ui zone. `createI18n(locale?)` and `LOCALES` (see `../internal.ts` "ui + i18n").

- Catalogs: `messages/<locale>.ts` for zh-CN (default), zh-TW, en, ja, ko, es, fr, de. `messages/en.ts` is the
  reference key set; every other catalog is typed against it, so a missing key fails to compile.
- Keys: `toolbar.*`, `progress.*`, `time.*`, `announce.*`, `key.*` (toolbar), `role.*` (agent role labels),
  `format.<adapter id>` (format names), `error.*` and `action.*` (shell messages).
- Messages use `{name}` variables; plural messages are objects keyed by CLDR category and select on `{count}`.
- Resolution: exact tag, then language (zh-Hant/zh-TW/HK/MO read Traditional), then English. With no
  argument the browser's `navigator.languages` are tried in order; with no locale information at all, zh-CN.
