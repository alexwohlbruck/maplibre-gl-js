# Port: variable `line-offset` via `line-progress` (from mapbox-gl-js PR #13614)

Goal: let `line-offset` take a `["line-progress"]` expression so the offset
**varies along the line** — bundled transit ribbons that merge/diverge smoothly
while keeping the runtime, constant-pixel, smooth-zoom offset. Reference PR:
https://github.com/mapbox/mapbox-gl-js/pull/13614 (full diff saved during
investigation). This is a **re-implementation**, not a cherry-pick: the PR is
built on Mapbox-v3 machinery (`a_z_offset_width`, `VARIABLE_LINE_WIDTH`,
`line-z-offset`, `evaluateLineProgressFeatures`, `isLineProgressConstant`,
`definesValues[]`) that **does not exist in MapLibre v4.7.1**. Rebuild it on
MapLibre's own per-vertex line-progress channel.

Branch: `transit/variable-line-offset` (this fork, from tag v4.7.1).

## 0. Fix the build env first
`npm install` fails on the `canvas` native dep (`node-pre-gyp not ok`). `canvas`
is only for render tests, not the library build:
```
cd maplibre-gl-js
npm install --ignore-scripts          # installs rollup/ts/plugins; skips canvas build
# (only if you want render tests:) brew install cairo pango libpng jpeg giflib librsvg && npm rebuild canvas
```
Toolchain present: node v22.19.0, npm 10.9.3, bun 1.3.10.

## 1. What MapLibre already has (reuse this)
- Per-vertex line-progress lives in the **ext buffer**: `LineBucket.layoutVertexArray2`
  (`LineExtLayoutArray`), populated in `addHalfVertex` **only when `this.lineClips`**
  (i.e. the source has `lineMetrics: true`, as line-gradient requires):
  ```ts
  // src/data/bucket/line_bucket.ts, addHalfVertex (~line 557)
  if (this.lineClips) {
      const uvX = (this.scaledDistance - this.lineClips.start) / (this.lineClips.end - this.lineClips.start);
      this.layoutVertexArray2.emplaceBack(uvX, this.lineClipsArray.length);   // a_uv_x, a_split_index
  }
  ```
  Bound as `layoutVertexBuffer2` with `layoutAttributesExt` (line_bucket.ts ~221),
  read as `in float a_uv_x` in `line_gradient.vertex.glsl`.
- The line shader already treats `offset` as a `#pragma mapbox` paint property:
  ```glsl
  // src/shaders/line.vertex.glsl
  #pragma mapbox: define lowp float offset      // ~line 26
  ...
  #pragma mapbox: initialize lowp float offset  // ~line 34
  offset = -1.0 * offset;                       // line 59
  mediump vec2 offset2 = offset * a_extrude * scale * normal.y * mat2(t, -u, u, t);  // line 74
  ```
- MapLibre bakes `line-gradient` into a **texture** (no per-vertex expression
  eval today). The offset feature needs **true per-vertex expression evaluation**
  in the bucket — the one genuinely new capability.

## 2. Implementation steps

### 2a. Style-spec: allow `line-progress` in `line-offset`
The spec is the external package `@maplibre/maplibre-gl-style-spec` (^20.3.1), but
the library build imports it. Two options: (a) fork/patch that package's
`src/reference/v8.json` and `bun link` it, or (b) patch-package the installed copy.
Edit `line-offset`'s expression `parameters` to append `"line-progress"`, and
broaden the `line-progress` expression doc to include `line-offset`. Mirror the
mapbox v8.json change (see PR). Verify `createPropertyExpression` then accepts a
`["line-progress"]` input on line-offset instead of erroring.

### 2b. LineBucket: evaluate offset per-vertex, pack into the ext buffer
`src/data/bucket/line_bucket.ts`:
- Detect a progress-driven offset in `addFeature`/constructor: read the layer's
  `line-offset` paint property; if its expression references `line-progress`
  (non-constant, progress-dependent), store it (`this.variableOffset = <expr>`)
  and force `lineMetrics` behaviour (so `this.lineClips` is set and uvX exists).
- Extend `LineExtLayoutArray` (in `src/data/array_types.g.ts` via
  `generate-struct-arrays`, or a new dedicated Float32 array) with a third
  component `a_line_offset`.
- In `addHalfVertex`, when `this.variableOffset`, evaluate it at the vertex's
  progress and emplace it:
  ```ts
  const off = this.variableOffset
    ? this.variableOffset.evaluate({zoom: this.zoom, lineProgress: uvX}, this.currentFeature) || 0
    : 0;
  this.layoutVertexArray2.emplaceBack(uvX, this.lineClipsArray.length, off);
  ```
  (Confirm the expression evaluation context accepts a `lineProgress` global; if
  not, thread it via `EvaluationParameters`/`GlobalProperties` like gradient does
  for its texture ramp.)
- Update `layoutAttributesExt` (src/data/bucket/line_attributes_ext.ts) to declare
  the new `a_line_offset` member.

### 2c. Shader: consume the per-vertex offset
`src/shaders/line.vertex.glsl` (and `line_pattern.vertex.glsl`):
```glsl
#ifdef VARIABLE_LINE_OFFSET
in highp float a_line_offset;   // from layoutVertexBuffer2
#endif
...
#pragma mapbox: initialize lowp float offset
#ifdef VARIABLE_LINE_OFFSET
    offset = a_line_offset;     // override the per-feature offset with the per-vertex one
#endif
offset = -1.0 * offset;
```
**Codegen gotcha:** `.glsl` is compiled to `.g.ts` — after editing, run
`npm run generate-shaders` (or `npm run codegen`) or the change is ignored.

### 2d. draw_line + program: define + attribute binding
`src/render/draw_line.ts`: add `VARIABLE_LINE_OFFSET` to the program defines when
the layer's line-offset is progress-driven (mirror how gradient/`lineMetrics`
gates binding `layoutVertexBuffer2`). `src/render/program/line_program.ts` (and
the LineDefinesType union): register the define and ensure the ext buffer is bound
for the plain line program (today it's bound for the gradient variant only).

## 3. Build
```
npm run generate-shaders          # REQUIRED after .glsl edits
npm run build-dist                # -> dist/maplibre-gl.js + .css (UMD, what the app imports)
# or build-dev for dist/maplibre-gl-dev.js
```

## 4. Validate
- MapLibre render tests (need canvas): move the PR's 4 new dirs to
  `test/integration/render/tests/line-offset/line-progress*` (v4.7.1 layout),
  then `npm run test-render line-offset`. Unit: `npm run test-unit -- line_bucket`.
- In Parchment: alias the app to this build (see §5), set a transit line layer's
  `line-offset` to e.g. `["interpolate",["linear"],["line-progress"],0,-4,1,4]`
  with the source `lineMetrics: true`, and confirm ribbons diverge smoothly on the
  Chicago Loop.

## 5. Integrate into Parchment (Vite alias — reversible, no reinstall)
`parchment/web/vite.config.ts` `resolve.alias` (CSS alias BEFORE bare specifier):
```ts
'maplibre-gl/dist/maplibre-gl.css': '/Users/alexwohlbruck/Documents/code/maplibre-gl-js/dist/maplibre-gl.css',
'maplibre-gl': '/Users/alexwohlbruck/Documents/code/maplibre-gl-js/dist/maplibre-gl.js',
```
Add `optimizeDeps: { exclude: ['maplibre-gl'] }`, `rm -rf web/node_modules/.vite`,
restart Vite. The app imports bare `maplibre-gl` in `web/src/types/map.types.ts`,
`web/src/lib/basemap-style.ts`, `web/src/components/map/map-providers/maplibre.strategy.ts`;
select the MapLibre engine (`MapEngine.MAPLIBRE` in `web/src/services/map.service.ts`).

## 6. Notes
- Parchment is Vite+**Tauri v2**: the same JS bundle runs in the mobile WebView, so
  this MapLibre port covers **desktop AND iOS/Android** — no native SDK involved.
- Once this works, the transit lines can drop the baked per-zoom offset matview and
  go back to a **runtime** `line-progress`-driven offset (smooth zoom + smooth
  merge/diverge), keeping the baked matview only as a fallback for the Mapbox engine.
- Upstreaming to MapLibre GL JS afterwards is worthwhile (there's no equivalent PR
  there yet).
