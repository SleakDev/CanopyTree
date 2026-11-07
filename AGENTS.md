# AGENTS.md — Project Guidance

Guidance for AI coding agents and contributors working on **CanopyTree**, a procedural
stylized tree studio.

## Project at a glance

- **What it is:** a browser-based, deterministic tree generator and product-style
  studio UI. A seed plus shape parameters produce a buttressed trunk, forked limbs,
  instanced foliage, and a lit studio backdrop. Users tune the tree, save/share looks,
  and export PNG or GLB.
- **Stack:** three.js (r187) + Vite 8, vanilla ES modules, plain CSS.
- **No framework, no TypeScript, no test runner, no linter.** There is no automated
  test suite. Verify changes by building and exercising the app in a browser.
- **Rendering:** WebGL2 is required. Target is ES2022.
- **Assets:** all bark, leaf, shadow, and backdrop textures are generated procedurally
  on canvases. There are no runtime image assets beyond the documentation reference
  photo.

## Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies. |
| `npm run dev` | Vite dev server at `http://127.0.0.1:5173` (strict port). |
| `npm run build` | Production build into `dist/`. This is the main correctness gate. |
| `npm run preview` | Serve the production build. |
| `start.bat` | Windows launcher: installs deps if missing, starts Vite, opens the browser when it responds. |

Environment notes:

- Windows + PowerShell is the expected shell. If `npm` is blocked by execution policy,
  use `npm.cmd`.
- Node 20+.
- `vite.config.js` pins host `127.0.0.1`, port `5173`, `strictPort: true`. Do not rely
  on another port.
- `dist/` and `node_modules/` are generated. Never edit them by hand.
- This workspace is not currently a git repository. Do not assume git commands work.

## Architecture

Data flows in one direction:

```
index.html
  └─ src/main.js            app bootstrap, state owner, rebuild loop, export plumbing
       ├─ src/state.js      DEFAULTS, PARAM_META, presets, URL state, saved presets
       ├─ src/ui.js         panel DOM, controls, tabs, modals, shortcuts, mobile sheet
       ├─ src/scene.js      renderer, camera, lighting, backdrop, floor, capture
       ├─ src/export.js     GLB baking (lazy-loaded)
       └─ src/tree/
            ├─ skeleton.js  trunk/limb/crown layout and branch depth data
            ├─ bark.js      bark geometry, fork/root sleeves, ground clip, texture
            ├─ voxelize.js  optional voxel remesh + diagnostic voxel shell
            ├─ foliage.js   leaf geometry/texture, rosettes, colors, wind, core
            └─ generate.js  assembly, stats, bounds, disposal
```

Supporting modules:

- `src/rng.js` — string seed hashing, mulberry32, `Rng` with labeled forks.
- `src/noise.js` — value noise and FBM.
- `src/styles.css` — design tokens, light/dark themes, responsive layout.

## Core invariants

### 1. Generation must stay deterministic

The same seed + parameter object must always produce the same tree.

- Use the provided `Rng` streams, never `Math.random()` in generation code.
- Each subsystem gets an independent stream via `rng.fork(label)` so changing one
  feature does not reshuffle another.
- Noise must come from `createNoise(seed)` / the passed noise object.
- Any new stage that consumes randomness needs its own fork label and must consume it
  in a fixed order.
- Presets, share links, thumbnails, and reproducible bug reports all depend on this.

### 2. Parameters are plain data and the single source of truth

Every visible or structural tree property lives in `DEFAULTS` in `src/state.js` and has
an entry in `PARAM_META`. `main.js` owns the live `state.params` object.

To add or change a parameter, keep all of these consistent:

1. `DEFAULTS` (default value).
2. `PARAM_META` (label, range/step/decimals/unit/hint, or `type: 'toggle' | 'options'`).
3. The relevant `PARAM_GROUPS` entry, and optionally `QUICK_CONTROLS`.
4. Consumer code (`skeleton.js`, `bark.js`, `foliage.js`, `scene.js`, `main.js`).
5. Any preset overrides in `PRESET_OVERRIDES` if it should affect a built-in look.
6. `README.md` if the control is user-facing.

`normalizeParams` / `clampParam` already handle URL and preset validation, so ranges in
`PARAM_META` are the contract. Do not add out-of-band state for tree structure; it will
not survive share links or saved presets.

Scene-only parameters are listed in **two** places that must stay aligned:
`SCENE_ONLY_PARAMS` in `src/main.js` and `SCENE_ONLY` in `src/ui.js`. `voxelPreview` is
handled separately because it only toggles visibility.

### 3. Rebuilds are async, debounced, token-guarded, and disposable

`generateTree()` is `async` because the voxel pass is dynamically imported.

- Rebuilds are scheduled with `setTimeout`, **not** `requestAnimationFrame`, so
  generation completes in background/hidden tabs.
- Every schedule increments `buildToken`. When an older build finishes late, its tree
  is disposed and discarded.
- Slider `live` phases debounce longer (about 110 ms) than `commit` (about 55 ms).
- Expensive voxel sliders (`voxelDepth`, `voxelResolution`, `voxelMeshDetail`) do not
  rebuild during `live`; they rebuild on release.
- Always dispose the previous tree (`disposeTree`) when replacing it. Geometry,
  materials, and every map (`map`, `bumpMap`, `normalMap`, etc.) must be released.
  Preview modes can detach maps from live materials, which is why `viewOriginals` is
  also scanned during disposal.
- Stale async results must be disposed, not added to the scene.
- Scene-only changes (`wind`, sun angles/intensity, `backdrop`, `quality`) avoid a full
  rebuild where possible.

### 4. Preview modes never affect exports or data

`Hide leaves`, `Hide branches`, `Gray`, `Wireframe`, and `Show voxel grid` are inspection
aids only.

- They live in the `view` object (`canopytree-view-v1`), separate from `state.params`.
- They are excluded from share URLs and saved presets.
- Exports run through `withNaturalPreview()` so the authored materials, full foliage,
  and remeshed bark are used, never the diagnostic preview.
- `Show voxel grid` swaps the bark mesh for the raw voxel shell; exports and preset
  thumbnails must always prefer the remeshed bark.
- When changing view logic, preserve the material snapshot/restore path. Gray and
  wireframe modes temporarily strip maps and vertex colors.

### 5. Ground, root, and floor alignment

These constants are coupled by design:

- Bark is physically clipped at `y = 0.003` (`clipGeometryToGround`).
- The studio floor sits at `y = 0.002`.
- Contact shadows sit at `y = 0.006` / `0.008`.

If you change one, check the others. The intent is roots that look planted and cut off
at the ground with no floating gap or visible buried geometry. The floor is a
soft-edged disc that fades into the backdrop; transparent exports hide it.

### 6. Voxel pipeline

`src/tree/voxelize.js` is optional and wood-only. It is dynamically imported from
`bark.js` so the chunk stays out of the initial load.

Pipeline order matters:

1. Rasterize triangles into a conservative surface shell.
2. Flood-fill air from the grid border; unreachable cells are solid.
3. Exact EDT (separable 1D squared distance transform) for a smooth signed field.
4. A `three-mesh-bvh` pass refines distance near the skin.
5. Blur the field only in a narrow band to round marching-cubes facets without
   changing topology.
6. Marching cubes.
7. **Weld vertices with `mergeVertices` before `SimplifyModifier`.** Unwelded MC
   output makes decimation explode or do nothing. This was a real bug; keep the weld.
8. Decimate to `voxelMeshDetail` (`0.05–1.0`, default `1.0`).

Constraints and expectations:

- `voxelResolution` is `48–256`, step 8, default `192`; `MAX_CELLS = 256`.
- `voxelDepth` selects how many branch levels are voxelized. Deeper levels remain
  authored tubes and are deliberately excluded from the diagnostic voxel preview.
- Voxelization must never include leaves or the canopy core.
- Remeshed bark uses continuous cylindrical UVs and procedural crevice colors to avoid
  visible UV patches from buried geometry.
- The voxel shell is a diagnostic cube mesh; it is never exported.
- Higher resolutions are expensive (seconds). Keep the loading wheel and async chunk.
- The loading label switches between `Voxelizing wood…` and `Growing leaves…`.

### 7. Export behavior

PNG export is rendered at fixed pixel sizes, independent of the window or pane size.
`viewer.capture({ width, height, transparent })`:

- Sets the renderer to the exact output size and pixel ratio 1.
- Sets camera aspect to `width / height`, preserving vertical FOV.
- Renders, reads the data URL, then restores the live renderer size, pixel ratio, and
  camera aspect.
- Falls back to the legacy `scale` path for internal thumbnails.

PNG choices exposed by the UI:

| Shape | Sizes |
| --- | --- |
| Square | 1024×1024, 2048×2048, 4096×4096 |
| 16:9 | 1920×1080, 2560×1440, 3840×2160 |
| Match view | 1024 / 2048 / 4096 wide at the live viewport aspect |

Default is **Square 2048×2048**. Transparent mode hides the backdrop, floor, and
contact shadows. Exports always use natural materials and the remeshed bark.

GLB export (`src/export.js`, lazy-loaded) bakes leaf instances into one indexed mesh
and includes `TrunkAndBranches`, `Foliage`, and `CanopyCore`. It intentionally excludes
the backdrop, camera, shadow planes, and diagnostic voxel cubes. When voxelization is
on, `TrunkAndBranches` contains the remeshed surface plus any preserved deep twigs.

When changing export sizes, update `src/ui.js` and the export sections of `README.md`;
do not reintroduce viewport-dependent output.

### 8. Responsive UI

- Desktop panel is a fixed side panel. Collapsing it reveals the floating **Tune**
  button. The state is persisted in `canopytree-panel-collapsed`.
- At `max-width: 1120px`, the panel becomes a bottom sheet. The sheet uses
  `z-index: 31`, above the `.mobile-scrim` at `30`, so it cannot be dimmed or blocked
  by its own scrim.
- `body.panel-open` controls sheet visibility; tapping the scrim or the close button
  dismisses it.
- Verify mobile changes at a narrow viewport (about 420 px), including tab clicks,
  close, scrim tap, and focus behavior.
- Preserve touch targets and safe-area insets (`env(safe-area-inset-bottom)`).
- The loading overlay is centered in the viewport and covers long rebuilds.

### 9. Persistence

Browser-local keys and their owners:

| Key | Contents |
| --- | --- |
| `canopytree-view-v1` | Preview modes: hide leaves/branches, shading. |
| `canopytree-theme` | Light/dark interface theme. |
| `canopytree-panel-collapsed` | Desktop panel collapsed / mobile sheet state. |
| `canopytree-looks-collapsed` | Looks rail collapsed state. |
| `canopytree-custom-presets-v1` | Saved custom presets with thumbnails. |

Share links use the URL hash (`encodeState` / `decodeState`, version `v: 1`) and only
encode non-default parameters plus the seed. The app does **not** mirror state into
the address bar while the user tunes; `buildShareUrl` is called only from the Share
action, and an applied hash is stripped with `history.replaceState` so the URL stays
clean. Treat that schema as a compatibility surface; bump the version if the payload
format changes.

### 10. Rendering and performance

- Foliage is one `InstancedMesh` with frustum culling disabled because instance bounds
  are large.
- Default builds target roughly 60–160 ms and ~4,000–6,000 leaves. Avoid work that
  scales badly per leaf (per-instance geometry, per-frame allocations).
- Reuse scratch vectors/objects in hot loops where practical.
- Dispose everything on rebuild. Leaks are easy to introduce with generated textures.
- Voxel builds are the slow path; do not make them run on every slider tick.

## Code conventions

- ES modules, single quotes, semicolons, 2-space indentation, trailing commas in
  multiline literals.
- `camelCase` for values/functions, `PascalCase` for classes and three.js-style types.
- Prefer small pure helpers near the top of a module; export the public factory/entry
  point.
- Comments should explain **why** (constraints, edge cases, non-obvious math), not
  restate the code. Existing JSDoc blocks document tricky pipeline stages; keep that
  style.
- Three.js objects are created locally and returned in a small result object
  (for example `{ mesh, geometry, material, uniforms }`), not attached to globals.
- UI changes: follow the existing event-delegation and `data-*` attribute patterns in
  `ui.js`. Keep controls generated from `PARAM_META`; do not hard-code a parallel list.
- CSS: use the custom properties in `:root` / `[data-theme="dark"]`. Do not hard-code
  palette colors that already have tokens. Add responsive rules in the existing
  `max-width: 1120px` block.
- Accessibility: keep labels, `aria-*` attributes, roles, focus handling, and keyboard
  shortcuts working. Do not remove focus styles.
- Keep `README.md` in sync for user-facing features, controls, architecture, and
  exports.

## Common tasks

### Add a tree parameter

1. Add the default to `DEFAULTS`.
2. Add metadata to `PARAM_META` (and a group in `PARAM_GROUPS`).
3. Consume it in the tree stage (usually `skeleton.js`, `bark.js`, or `foliage.js`).
4. Decide whether it is scene-only; if so update both `SCENE_ONLY` sets.
5. Ensure it clamps and round-trips through URL/preset normalization.
6. Add README/docs text if user-facing.

### Add a preset

1. Add an entry to `PRESET_OVERRIDES` with `name`, `blurb`, `seed`, `tone`, and
   `values` (only overrides of `DEFAULTS`).
2. Keep the six-preset keyboard mapping in mind; the rail and `1`–`6` shortcuts are
   position-based.
3. Thumbnails are generated live; do not commit image files for them.

### Change export sizes

1. Update the size tables in `openExport()` in `src/ui.js`.
2. Keep `outputSize()` as the single place that computes dimensions.
3. Pass explicit `width` / `height` through `main.js` to `viewer.capture`.
4. Verify the actual PNG dimensions, not just the modal summary.
5. Update `README.md`.

### Work on the voxel pass

1. Keep it wood-only and lazily imported.
2. Preserve the surface-shell → flood-fill → EDT → BVH refine → band blur → MC order.
3. Keep `mergeVertices` before `SimplifyModifier`.
4. Cap memory and polygon counts (`N <= 256`, `MAX_POLYGONS`).
5. Confirm both the diagnostic shell and the remeshed bark, at several mesh-detail
   values (for example `1.0`, `0.6`, `0.3`, `0.05`).
6. Confirm disposal and token cancellation when parameters change mid-build.

### Touch mobile layout

1. Change the `@media (max-width: 1120px)` rules in `styles.css`.
2. Keep the sheet above the scrim (`31` vs `30`).
3. Verify at ~420 px: open, tab switch, slider drag, close, scrim tap.
4. Check both light and dark themes.

## Manual verification checklist

Run before finishing any non-trivial change:

1. `npm.cmd run build` succeeds.
2. `npm.cmd run dev` (or `start.bat`) serves `http://127.0.0.1:5173`.
3. No console errors during load, rebuild, theme switch, or export.
4. A normal rebuild completes and the tree replaces the previous one cleanly.
5. Toggle every preview mode and confirm exports still look natural.
6. PNG export at one Square and one 16:9 size; decode/inspect the actual pixel size.
7. Transparent PNG hides the backdrop, floor, and shadows.
8. **Match view** keeps the live composition and restores the canvas afterward.
9. Voxelize on: loading wheel appears, remesh completes, preview shell is diagnostic
   only, deeper twigs remain tubes, and exports contain no voxel cubes.
10. Share URL reproduces the same seed and parameters; reset and presets work.
11. Mobile bottom sheet opens above the scrim and is fully interactive.
12. GLB export opens with bark and foliage and no studio geometry.
13. Light/dark themes both read correctly, including canvas backdrop.

## Dev hooks

In dev builds only, `window.__canopy` exposes:

- `viewer` — scene, renderer, camera, controls, capture.
- `tree` — current generated tree (bark, foliage, bounds, stats).
- `params` / `state` — live parameter and preset state.
- `ui` — UI controller.
- `rebuild()` — regenerate the current params.
- `export(format, options)` — run the export path directly.
- `render()` — draw one frame.
- `frame()` — reframe the camera.
- `look(position, target)` — set camera and target.

Example checks:

```js
__canopy.rebuild();
__canopy.export('png', { width: 2048, height: 2048, transparent: false });
__canopy.tree.stats; // { leaves, rosettes, branches, vertices, triangles, ms }
```

## Do not

- Do not edit `dist/`, `node_modules/`, or `package-lock.json` by hand.
- Do not introduce `Math.random()` into generation or use unseeded noise.
- Do not add tree state outside `state.params`.
- Do not make PNG output depend on viewport size.
- Do not let preview modes (hide, gray, wireframe, voxel grid) leak into exports.
- Do not remove the marching-cubes weld before decimation.
- Do not change ground/root/floor constants independently.
- Do not rebuild on every live tick of the expensive voxel sliders.
- Do not add runtime dependencies casually; the project is intentionally small.
- Do not leave stale geometry, materials, or textures undisposed after a rebuild.
- Do not remove accessibility labels, focus states, or keyboard shortcuts.
