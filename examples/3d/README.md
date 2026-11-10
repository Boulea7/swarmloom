# 3D samples

Two original models written for this repository, generated from three.js primitives by scripts in
`packages/adapter-three/scripts/`. They are the fixtures of the `@swarmloom/adapter-three` tests and the 3D
demo.

| File | Size | Triangles | What it covers |
| --- | --- | --- | --- |
| `loom-bot.glb` | 202 KB | 9,232 | A small robot holding a thread spool: eight PBR materials in the brand palette, one emissive. The main 3D demo, built in 40 to 60 patches depending on the stage size. |
| `shuttle.glb` | 29 KB | 1,120 | A low-poly weaving shuttle with a bobbin of thread: three meshes, three palette materials. |
| `shuttle.obj` | 66 KB | 1,120 | The same shuttle as three named objects without materials (palette fallback), Y-up. |
| `shuttle.stl` | 55 KB | 1,120 | The same shuttle as binary STL, Z-up as 3D-printing tools write it. |
| `shuttle.ply` | 43 KB | 1,120 | The same shuttle as binary little-endian PLY with per-vertex colours. |

The four shuttle files hold one shape, so they land on the same stage footprint; the unit tests check that
the GLB, OBJ, STL and PLY paths agree.

Regenerate them with:

```sh
pnpm -F @swarmloom/adapter-three samples
# or: node packages/adapter-three/scripts/gen-loom-bot.mjs [out.glb]
#     node packages/adapter-three/scripts/gen-shuttle.mjs [out-dir]
```

The output is deterministic: the bytes change only when a script or the three.js version changes.

The shapes, colours and names are original. License: MIT.
