# @swarmloom/adapter-mindmap

The mind map adapter for SwarmLoom. It reads XMind (`.xmind`: `content.json` from XMind Zen / 2020 and later, `content.xml` from XMind 8) and FreeMind / Freeplane (`.mm`) files and lays them out as a tree that the swarm weaves from the root out to the leaves. Load it through `@swarmloom/formats` so it is only fetched when needed.

```ts
import { mindmapAdapter } from "@swarmloom/adapter-mindmap";

const { blueprint } = await mindmapAdapter.load({ bytes }, { document, width: 1100, theme: "light" });
```

How it works:

- `.xmind` archives are unzipped with fflate. Only `content.json` and `content.xml` are inflated, and parts larger than 20 MiB are refused before inflating. `.mm` files are parsed with `DOMParser`; DTDs and entities are refused.
- Topics keep their title, plain-text note, folded flag and link (only `http:`, `https:` and `mailto:` links are kept). The first sheet is drawn; extra sheets, floating topics, summaries and callouts are counted in `blueprint.truncated`. The node limit is 1500 and the depth limit 24.
- The layout is our own and deterministic: the root sits in the middle, first-level branches are split left and right so both sides are about as tall (FreeMind `POSITION` hints win), and deeper levels grow outward. Titles wrap at a per-level width with real text measurement. When the map is wider than `ctx.width` the layout tries right-only, then scales down to 45 %.
- Every topic is a box layer plus a text layer, and every edge a cubic bezier path layer drawn with the pen. Each connector waits for its parent topic and each topic for its connector, and priorities grow with depth, so the build goes root, then branches, then leaves. Branch colours come from the SwarmLoom palette. No plugin is needed.

Options (`createMindmapAdapter`): `maxBytes` (32 MiB), `maxNodes` (1500), `maxDepth` (24), `maxPartBytes` (20 MiB).

Limits: no relationship lines, boundaries, markers, icons or images; topic styles from the source file are replaced by the SwarmLoom theme; only the first sheet is shown.

Dependencies: `fflate` (MIT).

License: MIT.
