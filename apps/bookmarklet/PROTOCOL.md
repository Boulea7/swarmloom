# Bookmarklet protocols

This file is the contract between the bookmarklet and the other parts of SwarmLoom. The
TypeScript source of truth is [`src/protocol.ts`](src/protocol.ts), importable as
`@swarmloom/bookmarklet/protocol` (constants, `PagePayload` and `parsePagePayload`).

There are three parties:

| Party | Where it runs | Code |
|---|---|---|
| Loader | the `javascript:` URL, in the page the user is on | `src/loader.ts`, `src/handoff.ts`, `src/serialize.ts` |
| Hosted bundle | `<pages>/bm/swarm.js`, injected into that page as a module script | `src/swarm.ts`, `src/bundle/*` |
| Studio | `<pages>/studio/`, a separate tab on the Pages origin | `apps/studio` (receiver) |

`<pages>` is the Pages base the bookmarklet was built for, `https://boulea7.github.io/swarmloom/` by
default (`node scripts/build.mjs --base <url>`, or `SWARMLOOM_PAGES_BASE`).

## 1. Studio handoff (page to Studio)

When the page cannot run the hosted bundle, the page is serialized in the browser and handed to
the Studio tab, which rebuilds the copy there. Nothing is uploaded.

### When it happens

| `reason` | Trigger |
|---|---|
| `blocked` | A Content Security Policy blocked the bundle (`securitypolicyviolation` with `disposition: "enforce"` for the bundle URL), or Trusted Types rejected the `src` assignment. |
| `error` | The script element fired `error` (CSP in browsers that report only the origin, or a network failure). |
| `timeout` | The bundle did not start within 10 s (slow network, or the bundle threw while loading). |
| `manual` | The bundle loaded but could not rebuild the page in place, and the user pressed "Open in Studio" on its notice. |

The loader falls back at most once per click, whichever signal comes first.

### Opening the Studio

The page calls `window.open(studioUrl)` without `noopener`, so the Studio tab gets
`window.opener`. `studioUrl` is the configured Studio URL (default `../studio/?from=bookmarklet`,
resolved against the bundle URL, i.e. `https://boulea7.github.io/swarmloom/studio/?from=bookmarklet`).
The build refuses a Studio URL without `from=bookmarklet`: that parameter is how the Studio knows it
should ask its opener for a page.

If the browser blocks the popup (the user activation from the bookmark click has expired, which is
normal after a timeout or on mobile omnibox launches), the page shows an "Open in SwarmLoom Studio"
button at the top; its click opens the tab and the handshake proceeds the same way.

### Handshake

```text
Page (opener)                                     Studio tab (?from=bookmarklet)
  serialize page -> payload
  open Studio, listen for "message" on window
                                                  load
                     <-- "swarmloom:page" -------   opener.postMessage("swarmloom:page", "*")
  studio.postMessage(payload, studioOrigin) ----->  validate, then rebuild the copy
```

1. Right after `window.open` returns, the page adds a `message` listener to its own window. It is
   registered before the Studio document can load, so the Studio's first request is always heard.
2. The Studio posts the bare string `"swarmloom:page"` (`MSG_PAGE`) to `window.opener` with
   `targetOrigin` `"*"`. The request carries no data, so any origin may receive it.
3. The page answers every such request by posting the `PagePayload` to the window it opened, with
   the Studio origin as `targetOrigin`. The listener stays for the lifetime of the page, so a
   reloaded Studio tab can ask again. The page keeps one copy of the payload for that.

### Payload (`PagePayload`, version 1)

```ts
interface PagePayload {
  type: "swarmloom:page";
  v: 1;
  reason: "blocked" | "error" | "timeout" | "manual";
  url: string;   // document.URL of the page (informational)
  html: string;  // serialized document, see below
  viewport: { x: number; y: number; w: number; h: number; dpr: number };
}
```

- `html` is `<!DOCTYPE html>` (when the page has a doctype), then `<base href="{document.baseURI}">`,
  then `document.documentElement.outerHTML` of a clone of the document in which:
  - password inputs have an empty `value` attribute;
  - every `<style>` element holds the rules of its CSSOM sheet (CSS-in-JS libraries insert rules
    without text, and `outerHTML` would lose them).

  The HTML parser moves the leading `<base>` to the start of `<head>`, where it wins over any `<base>`
  of the page, so rendering the markup as a document resolves every relative URL (`src`, `href`,
  `srcset`, CSS `url()`) to the original absolute URL. Form values the user typed are not in the
  markup (only attributes are serialized).
- `viewport`: `x`/`y` are the window scroll offsets, `w`/`h` the layout viewport (`innerWidth`,
  `innerHeight`) and `dpr` the device pixel ratio, all at capture time, in CSS px. Rebuild the copy at
  width `w` and start with `y` in view to match what the user saw.
- Version 1 may gain optional fields. Receivers ignore unknown fields and reject other `v` values.
  An incompatible change bumps `PROTOCOL_VERSION`.

### Origin rules

Sender (the page):

- Answers only to the window it opened, and only with the Studio origin as `targetOrigin`. If that
  tab navigated anywhere else, the browser drops the message. The page never posts the payload with
  `"*"`.
- Answers any `"swarmloom:page"` request whatever its source. That is safe because a request carries
  no data and the answer can only reach the Studio tab.

Receiver (the Studio):

- Accepts only messages whose `event.source === window.opener`.
- Does not allowlist `event.origin`: the bookmarklet runs on any site, so the origin is whatever site
  the user was on (`"null"` for `file:` pages and opaque origins). Show it to the user as the source
  of the copy. `payload.url` is what the page says about itself; prefer `event.origin` when they
  disagree.
- Validates the shape before use: `parsePagePayload(event.data)` checks `type`, `v`, `reason`, an
  absolute `url` of at most 8192 characters, a non-empty `html` of at most `MAX_PAGE_HTML_LENGTH`
  (32 Mi UTF-16 code units) and finite positive viewport sizes. Invalid messages are ignored, not
  answered.
- Uses the first valid payload and stops listening, and gives up with a clear message after a
  timeout (the Studio uses 15 s).

### Treat the copy as untrusted

`html` is arbitrary markup from an arbitrary site. It still contains scripts, inline event
handlers, hidden inputs and any data the page embedded in its markup. The Studio must:

- render it only through the html adapter, which runs no scripts and allows network access only
  for `https:` images and fonts with `referrerpolicy=no-referrer`; never insert it
  into the Studio's own DOM;
- keep it in memory only: do not store it, put it in a share link or send it to any server unless
  the user explicitly asks (for example by exporting);
- drop it when the user closes the scene.

### Known limits

- Pages served with `Cross-Origin-Opener-Policy: same-origin` sever the opener of a cross-origin
  popup. The Studio then has no `window.opener`, nothing arrives, and the Studio should suggest
  saving the page as HTML (or a PDF) and opening that file instead.
- Browser pages (settings, extension stores, the new tab page) and built-in PDF viewers do not run
  bookmarklets at all.
- Content in cross-origin iframes, closed shadow roots, canvases and videos is not in the markup.

## 2. Loader and hosted bundle (inside the page)

These are internal to this package and may change between releases; they are listed so the
loader and bundle stay compatible when only one of them updates (old bookmarks keep working with a
new bundle).

- The loader injects `<script id="swarmloomBm" type="module" data-swarmloom-bm="{options}">` with
  `src` set to the bundle URL, appended to `<html>`.
- The bundle registers a `BookmarkletHandle` at `window.__swarmloomBm` and, while the script
  element is still in the page, removes it and starts a rebuild with its options. A missing element
  means the loader already fell back; the bundle then only registers the handle.
- Later clicks call `window.__swarmloomBm.toggle(options)`: it stops a rebuild in progress, or
  starts a new one when none runs or the previous one finished.
- Options are `key=value` pairs joined by `&`, at most 512 characters: `speed` (0.25 to 4), `sound`
  (`1` or `0`), `agents` (1 to 64 or `auto`), `labels` (`names`, `agents`, `roles`, `none`), `finale`
  (`flock`, `halo`, `none`), `theme` (`auto`, `light`, `dark`), `follow` (`scroll`, `tour`, `none`),
  `locale` (BCP 47) and `seed` (a 32-bit unsigned integer). The bundle ignores unknown keys and drops
  invalid values with a console warning (`src/options.ts`).
- Leaving the page (`pagehide`) or a route change (Navigation API `navigate`, else `popstate`, to
  another origin or path) ends the rebuild. Fragment and query-only changes keep it.
