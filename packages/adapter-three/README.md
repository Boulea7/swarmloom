# @swarmloom/adapter-three

The 3D model adapter for SwarmLoom. It reads GLB, glTF (with embedded data), OBJ, STL and PLY with
[three.js](https://threejs.org) (`three`, MIT) and its official loaders, and plans a build the swarm plays
on one WebGL canvas: vertices are tapped in as points, feature edges are pulled with the pen, faces are
swept in patch by patch, then materials fade in, a key light sweeps across and the camera orbits the
finished model. After the build the model can be rotated by drag and zoomed by wheel or pinch.

Load it through `@swarmloom/formats` so three.js is only fetched when a model is opened.

```ts
import { threeAdapter } from "@swarmloom/adapter-three";

const source = await threeAdapter.load({ name: "model.glb", bytes }, { document, width: 960, theme: "light" });
// Pass source.blueprint and source.plugins to the player; call source.dispose() when done.
```

## What the blueprint contains

The model is split into spatial patches (connected clusters of triangles, one cursor per patch). Every
layer is a `custom` layer handled by the `three` plugin that `load()` returns in `LoadedSource.plugins`:

| Layer id | Task | What the cursor does |
| --- | --- | --- |
| `three:<n>:points` | `three:points` | Taps the patch's vertices in, chunk by chunk. |
| `three:<n>:edges` | `three:edges` | Pulls feature edges (boundaries and creases, not every triangle edge) with the pen. |
| `three:<n>:faces` | `three:patch` | Drags across the patch while its triangles grow in along the sweep. |
| `three:material:<g>` | `three:material` | Waits for the patches of a material group, then drags a slider while clay turns into the material. |
| `three:light` | `three:light` | Waits for everything, then sweeps a key light across the model; the finale orbit follows. |

Per patch the layers are chained points, edges, faces through `parent`; a material group follows the last
patch it covers and the light follows the last material group. Layer data holds only stage-pixel anchors
and indices; the geometry stays in the plugin, so a blueprint stays small. Point clouds (PLY without faces)
build as points only.

The plugin:

- `setup(stage, host)` puts a transparent WebGL 2 canvas at the back of the stage host, with a neutral
  studio rig (hemisphere and key light, room reflections), a soft ground shadow and a fading floor grid.
  Without WebGL 2 it shows an accessible notice instead and the build still runs.
- `frame(now)` renders on engine time, and only when something changed, so exports are frame-exact.
- `project(p)` maps a build-time anchor to the current screen point once the camera has moved, so cursors
  stay on the model during and after the finale orbit.
- Under the player's reduced motion (`StageApi.reducedMotion`; `reducedMotion: "auto"` reads
  `prefers-reduced-motion`) there is no pop-in and no orbit. Exports set it themselves, so the host's
  preference never changes a video.
- The cleanup returned by `setup` and `LoadedSource.dispose()` release every GPU resource.

The model is centred and fitted to its bounding sphere. Formats without materials (OBJ, STL, PLY without
colours) get colours from the brand palette; vertex colours are kept. The background follows
`AdapterContext.theme`.

## Budgets

- Models above `maxTriangles` (200,000) are simplified; `Blueprint.truncated` says so.
- Patches scale with the model (about 150 triangles each, at least 16) and with the stage area, never more
  than `maxPatches` (160, hard cap 400) or what `AdapterContext.maxLayers` allows.
- Build time: with the engine's automatic cursor count, `loom-bot.glb` (9,232 triangles) builds in about
  12 to 15 s from phone to laptop stages, and the small shuttle in about 9 s (measured with a simulated
  scheduler, not in the real engine). With a fixed count of 8 cursors the robot takes about 34 s.

## Options

`createThreeAdapter(options)` returns an adapter with its own options. Non-numeric values throw a
`TypeError`; numbers are clamped to their range.

| Option | Default | Meaning |
| --- | --- | --- |
| `height` | viewport height | Stage height in CSS px (else 9:16 of the layout width). |
| `maxBytes` | 64 MiB | Largest accepted file. |
| `maxTriangles` | 200,000 | Triangles kept for rendering. |
| `maxSourceTriangles` | 4,000,000 | Larger models are rejected before decoding. |
| `maxPatches` | 160 | Upper bound on build patches (at most 400). |
| `maxPoints` / `maxEdges` | 60,000 / 40,000 | Vertices and edges animated during the build; the final mesh is always complete. |
| `maxCloudPoints` | 300,000 | Point-cloud points kept. |
| `upAxis` | STL `"z"`, others `"y"` | Up axis of OBJ, STL and PLY. |
| `dracoDecoderPath` | - | Base URL of the Draco decoder files (`three/examples/jsm/libs/draco/`). Needed only for Draco-compressed glTF. |
| `orbitDegrees` | 45 | Finale orbit; 0 disables it. |

The Draco and Meshopt decoders are imported only when a file uses them. Without `dracoDecoderPath` a Draco
model is rejected with a clear message instead of fetching a CDN.

## Errors

`load()` rejects with a `ThreeAdapterError` whose `code` is one of `empty`, `too-large`,
`unsupported-format`, `invalid`, `external-resource` (glTF that references other files; export a GLB),
`unsupported-extension`, `needs-decoder`, `no-geometry` or `fetch-failed`. Messages are English and can be
shown to the user.

## Limits

- Everything is offline: glTF files with external buffers or images, and OBJ `mtllib` materials, are not
  loaded (OBJ falls back to the palette and says so).
- glTF files that require KTX2 textures (`KHR_texture_basisu`) are rejected.
- glTF animations, skins and morph targets are shown in their rest pose.
- Gaussian-splat PLY files show their splat centres as points.

## Samples

`examples/3d/` holds `loom-bot.glb` and the shuttle in GLB, OBJ, STL and PLY, generated by
`pnpm -F @swarmloom/adapter-three samples`.

License: MIT.
