# MapLibre GL JS fork: changes over upstream, for porting to MapLibre Native

This document lists every behaviour change the fork makes on top of upstream MapLibre GL JS, so the same changes can be re-implemented in MapLibre Native (C++, used by the iOS and Android SDKs). Each feature gives its purpose, API and style-spec surface, exact behaviour, GL JS implementation, tests, porting notes and commits. Native class and file names are best guesses from the GL JS architecture and are marked "likely"; check them against the Native tree before relying on them.

## Base, versioning and distribution

- **Upstream base:** tag `v6.19.0`, merged into the fork in `653b492b5` (`v6.19.0-transit.1-terrain.1`). The fork started from `v6.11.2` (`acb7b722f`); the commit hashes below are the original fork commits on that base, and *Synced to v6.19.0* says where the code has since moved.
- **Versions and tags:** `v<upstream>-transit.N-terrain.M`. `transit.N` counted the first round of features (transit lines, line elevation, symbol work, horizon fade; `transit.1` to `transit.18`). `terrain.M` counts the second round, built on `transit.18` (terrain haze, hiding without reload, terrain and extrusion performance, shading; `terrain.1` to `terrain.8`). `package.json` `version` matches the tag.
- **`dist/` is committed.** Consumers install from a git tag without a build toolchain, so most features are followed by a "Build dist" or version-bump commit. Those commits carry no source change and are left out below. `package.json` also drops upstream's `prepare: npm run codegen` script for the same reason.
- **Spec additions** live in `src/style-spec/fork_extensions.ts`. It adds entries to the style-spec `v8` reference object at import time and is imported first by `src/index.ts`, `src/source/worker.ts` and `build/generate-style-code.ts`, so validation, expression parsing and generated property classes all see the new properties. In Native the equivalent is likely editing the spec JSON that drives `scripts/generate-style-code.js` and regenerating the `*_layer_properties` files.
- **Layer metadata keys** (`parchment:decal`, `parchment:horizon-fade`) are read from the layer's `metadata` object, not from the spec.
- **Pulled in early from upstream:** `ce10d2208` (bidi support, deprecating the RTL plugin, upstream PR #8343) and `2da49917e` (`font-faces` style property, upstream PR #8237) are upstream commits already contained in `v6.11.2`. They are not fork features and are not documented here.

## Synced to v6.19.0

Upstream replaced the per-render `RenderContext` object (`src/render/render_context.ts`, deleted) with the `FrameRenderContext` class (`src/render/frame_render_context.ts`), which now owns the stencil clipping masks, `getProjectionDataForTile`, `getTerrainDataForTile`, `useProgram` and the depth and colour modes. The painter no longer exposes `transform` or `style` to draw code; the frame's camera does. What moved in the fork:

- `elevatedPass` (and the `ElevatedPass` type) is a field of `FrameRenderContext`, not `RenderContext`.
- Clipping-mask reuse across sources and drawing only missing masks lives in `FrameRenderContext.renderTileClippingMasks`; masks drawn into a render-to-texture pass are forgotten after it, so they are never reused on screen.
- `FrameRenderContext` carries the map's `Shading`; `Shading.prepare(style, frameRenderContext)` and `Shading.drawGround(frameRenderContext)` read the frame's camera instead of `painter.transform` / `painter.style`.
- `ProgramCache` and `FrameRenderContext.useProgram` take the extra shader source the shading's wall shader needs.
- The per-frame elevation-range cache is upstream's `_minMaxElevationCache` (upstream #9050), cleared by the fork's `Terrain.beginFrame()`; `DEM_CELL_CENTER_OFFSET` is exported from `terrain_coverage.ts` for the anchor elevation reader.
- Lines take upstream's join offset vectors (#8570, #9092) at attribute location 2; the variable-offset shader's `a_line_offset` moved to location 3. Elevated lines draw through upstream's layer composite (which replaced layer opacity).
- The terrain worker is created, restarted and terminated with upstream's worker lifecycle (#8491).

Render tests that differ from upstream's expected images because of fork behaviour (terrain haze, horizon fade, building ground elevation, negative extrusion height) still differ; they are not regressions.

## Summary

| Feature | Spec / API surface | Commits |
|---|---|---|
| Variable `line-offset` along `line-progress` | `line-offset` accepts `["line-progress"]` (source needs `lineMetrics: true`); shader variant `lineVariableOffset`, ext attribute `a_line_offset` | `f19ffd515`, `54e6601b0`, `6ce9cbd2a` |
| Eased offset on vector tiles; lines clipped past the coordinate range | none (a line with no clip tags counts as the whole line) | `6ce9cbd2a` |
| `line-rounded-corner-distance` | layout, number, metres, default 0, data-constant | `2d5cf38cf` |
| Symbol anchor offset | layout `symbol-anchor-offset` (`[x,y]` px, default `[0,0]`, data-driven, interpolated), `symbol-anchor-offset-alignment` (`map`/`viewport`, default `viewport`) | `f19ffd515` (`7ccc7e5a2` moves its attribute) |
| Isolated collision layers | `MapOptions.isolatedCollisionLayers?: string[]` (fixed at construction) | `f19ffd515` |
| Line elevation profiles | layout `line-elevation-profile` (string, data-driven), paint `line-depth-occlusion-factor` (0..1, default 1); attribute `a_elevation` | `d4da4b0d8`, `0e74dcf2f`, `999d1c7bb` |
| Datum heights and `line-pitch-alignment` | paint `line-pitch-alignment` (`map`/`viewport`, default `map`); `~` prefix in profiles | `999d1c7bb` |
| Elevated line draw order / underground pass | none (internal `FrameRenderContext.elevatedPass`) | `cd7a8cfeb`, `331f48e06` |
| Profile point snapping and run paths | none | `331f48e06`, `c72c06fd7` |
| `symbol-height-anchor` per feature | `symbol-height-anchor` made data-driven; `a_height_offset` becomes vec2 | `7ccc7e5a2` |
| Distant label gamma precision | GLSL `highp` only | `c2c4a76cd` |
| Decal icons | layer metadata `parchment:decal` | `bd140a8a2` |
| Horizon fade (lines, symbols, circles) | on by default; metadata `parchment:horizon-fade: false` opts out | `78b35b1d6` |
| Terrain haze | none; uses sky `fog-color` | `0cb012c9c` |
| Drape beneath | `MapOptions.drapeBeneath` (bool, default false) | `763f20689`, `4a3ef5414` |
| Terrain worker | none public (`WorkerPool.acquireTerrain`, `Dispatcher.getTerrainActor`) | `d77e044c2`, `ef22fff32` (`709b68c21`, `79f332311` superseded) |
| Per-frame elevation-range cache | internal `Terrain.beginFrame` | `6278321dc` (part) |
| Building ground elevation buffer, tile-agreed anchor | internal attribute `a_anchor_elevation` replaces `a_centroid` | `43e498a61` |
| Anchors kept on the GPU | `FillExtrusionBucket.centroidVertexBuffer` | `75f89a5c9` |
| 3D depth range for custom layers | `CustomRenderMethodInput.depthRangeFor3D: [number, number]` | sync to v6.19.0 |
| Clipping-mask reuse | none | `f3cddca7d`, `5d70660cc` |
| Tile cache kept through a layer change | internal `TileManager.relayout` | `a91513a81` |
| Parse a tile's layers as read | none | `6278321dc` (part) |
| Labels placed half as often while panning | none (`MOVING_PLACEMENT_STRETCH = 2`) | `f6bb4474e` (part) |
| Muted layers | `Map#setLayerMuted(layerId, muted)`, runtime only | `d8ea3c430` |
| Symbol clip | `Map#setSymbolClip(layerIds, Polygon \| MultiPolygon \| null)` | `d8ea3c430` |
| Negative extrusion height hides | `fill-extrusion-height < 0` not drawn | `d8ea3c430` |
| Sun shadows and ground occlusion | `Map#setShading(options \| null)`, `Map#getShading()`; types `Shading`, `ShadingOptions`, `ShadingCaster`, `SunFrame`, `OcclusionFrame`, `WallShader`; paint `fill-extrusion-cast-shadows`, `-roof-color`, `-facade-style`, `-facade-seed` | `f6bb4474e`, `f9e301cdc` |
| Ground occlusion for casters | `ShadingCaster.receiveOcclusion`, `GroundOcclusion` | `f9e301cdc` |
| Lamplight | shading fields `lightIntensity`, `spillColor`, `lightBlur`, `lightHeight`; `ShadingCaster.drawLights`/`receiveLights`, `GroundLights`, `WallShader.light` | `9f4378d49` |

The app's postinstall patch to terrain and extrusions (`web/scripts/patch-maplibre-terrain.mjs` on Parchment `dev`) was absorbed whole by `43e498a61`, so nothing outside the fork still changes engine behaviour. See "Building ground elevation" below.

## Transit lines

Transit ribbons in Parchment are bundles of parallel lines that sit side by side with `line-offset` and have to merge, split and swap places smoothly where routes join or leave a corridor. Upstream evaluates `line-offset` once per feature, so an offset can only change in a step at a feature boundary. The fork lets the offset change continuously along a line, makes that work on plain vector tiles as well as GeoJSON with `lineMetrics`, stops lines that run past a tile's coordinate range from being bent, and rounds polygon outlines so an outline traces a rounded extrusion. The symbol side of transit (`symbol-anchor-offset`, isolated collision layers) is covered in its own section.

### Variable `line-offset` along `line-progress`

**Purpose.** `line-offset` can be an expression of `["line-progress"]`, so the offset varies per vertex along the line. A transition ribbon can ease from one lane of a bundle to another over its own length.

**API / style-spec surface.**
- No new property. The existing paint property `line-offset` (number, pixels, default `0`, `interpolated: true`, `parameters: ["zoom", "feature", "feature-state"]`, transitionable, `property-type: data-driven`) now *behaves* differently when its expression references `["line-progress"]` anywhere in the tree. Example: `["interpolate", ["linear"], ["line-progress"], 0, -10, 1, 10]`.
- The style spec was **not** edited for this. The upstream spec lists `line-progress` only for `line-gradient`, but the expression parser does not reject it elsewhere: it is a global like `zoom` (`ctx.globals.lineProgress || 0`). So the property validates and parses unchanged, and `fork_extensions.ts` has no `line-offset` entry. (The earlier design note's step 2a, patching `v8.json`, turned out to be unnecessary.)
- Source requirement: the line needs a progress value. That means GeoJSON with `lineMetrics: true` (geojson-vt adds clip tags), or, from `6ce9cbd2a` on, any vector-tile line without clip tags (next feature).

**Behaviour.**
- Detection: `LineStyleLayer.hasVariableOffset()` walks the expression AST (`_styleExpression.expression`, recursing via `eachChild`) and returns true if any node has `name === 'line-progress'`. This walk is needed because the possibly-evaluated pipeline treats a `line-progress` expression like a global-constant one (`kind` is `constant` or `camera`), so `paint.get('line-offset').kind` cannot tell it apart.
- Evaluation happens **in the bucket, once per vertex, at layout time** (worker). It runs at the bucket's zoom (`LineBucket.zoom`, the tile zoom), with `lineProgress` set to the vertex's *global* progress and the current feature (so `["get", …]` works).
  - Global progress is `scaledDistance = clip.start + (clip.end - clip.start) * distance / totalDistance`, i.e. 0..1 over the whole original line mapped through the feature's clip range. It is **not** `uvX` (`(scaledDistance - clip.start) / (clip.end - clip.start)`, 0..1 per tile piece). With `uvX` every tile would replay the whole ramp and the offset would jump at tile boundaries. `uvX` is still written for the gradient path.
  - A result of `null`/`NaN` becomes `0`.
- Consequences of baking:
  - Zoom dependence is frozen at the tile's zoom: an `["interpolate", …, ["zoom"], …]` wrapped around the progress ramp steps per tile zoom instead of following the camera zoom smoothly.
  - `feature-state` and `line-offset` transitions have no effect on the baked value.
  - The pixel value is still applied at draw time in screen pixels (`offset2 / u_ratio`), so the ribbon keeps a constant pixel separation within a zoom level.
- One expression per bucket. Layers that share a bucket share layout, but paint can differ; the **first** layer in `bucket.layers` with a variable offset supplies the expression and the others get its values. Upstream already picks a single gradient per bucket the same way.
- Cache (from `6ce9cbd2a`): both halves of a vertex, and every vertex of a round join, share one progress. The bucket caches `(offsetFeature, offsetProgress) → offsetValue` and only re-evaluates when the feature or `scaledDistance` changes.
- Shader variant selection in `drawLine`, in priority order: `linePattern` > `lineGradientSDF` > `lineSDF` > `lineGradient` > **`lineVariableOffset`** > `line`. A pattern, dashed or gradient line therefore **ignores** the per-vertex offset. It uses the ordinary paint-evaluated `offset`, which for a progress expression evaluates with `lineProgress` unset, i.e. the value at progress 0.
- Globe, terrain: the variant is the plain line shader with `offset` replaced, so it inherits `projectTile`, `projectLineThickness`, the `GLOBE` depth varying and the `TERRAIN3D` gamma path unchanged. With `line-elevation-profile` (Line elevation section) the same `a_line_offset` is read by the elevated path.

**Implementation in GL JS.**
- `src/style/style_layer/line_style_layer.ts`: `offsetExpression()` returns `_transitionablePaint._values['line-offset'].value.expression`, plus `hasVariableOffset()` and a module helper `expressionReferencesLineProgress()`.
- `src/data/bucket/line_attributes_ext.ts`: the ext ("layout 2") vertex layout gains `a_line_offset` (Float32 ×1) after `a_uv_x`, `a_split_index`. At HEAD the layout is `a_uv_x` f32, `a_split_index` f32, `a_line_offset` f32, `a_elevation` f32×4 (added by Line elevation): 28 bytes per vertex.
- `src/data/bucket/line_bucket.ts`:
  - The constructor sets `variableOffsetExpression` from the first layer whose `hasVariableOffset()` is true, and a reused `evaluationGlobals = {zoom, lineProgress}` object.
  - `addFeature` stores `currentLineFeature`.
  - `addHalfVertex` evaluates the offset (only when `variableOffsetExpression && lineClips`) and emplaces it into `layoutVertexArray2` with the other ext members.
  - The ext buffer is written for every vertex whenever `lineClips || elevated`. For constant offsets the member is `0`, so the buffer stays valid for every variant.
  - `register('LineBucket', …, {omit: [... 'variableOffsetExpression', 'currentLineFeature', 'offsetFeature', 'offsetProgress', 'offsetValue']})` keeps these fields out of worker→main transfer.
- `src/shaders/glsl/line_variable_offset.vertex.glsl` (new; fragment is the stock `line.fragment.glsl`): a copy of `line.vertex.glsl` with `layout(location = 2) in float a_line_offset;`. After the `#pragma maplibre: initialize lowp float offset` line it does `offset = a_line_offset;`, then the stock `offset = -1.0 * offset;` and `offset2 = offset * a_extrude * scale * normal.y * mat2(t, -u, u, t)`. Registered in `src/shaders/shaders.ts` as `lineVariableOffset: prepare(lineFrag, lineVariableOffsetVert)`. In `src/webgl/program/program_uniforms.ts` it reuses `lineUniforms`.
- `src/webgl/draw/draw_line.ts`: variant selection as above. `program.draw(..., bucket.layoutVertexBuffer2)` already passes the ext buffer as the dynamic layout buffer, so attributes bind by name.
- Attribute location (`54e6601b0`): the first port pinned `a_line_offset` to location 4, "its place in the ext buffer". In MapLibre GL JS, explicit locations index the *shader's own* static inputs, and paint (`#pragma`) attributes are assigned the locations after them. Location 4 collided with a paint attribute. It is now location 2: the third static input after `a_pos_normal` (0) and `a_data` (1). The same family of bug caused `0e74dcf2f` for `a_z` (Line elevation section).
- Codegen gotcha, guarded by a test: the shader codegen's static-attribute regex captures `in <type> <name>`. A precision qualifier (`in highp float a_line_offset`) makes it register the wrong name, the attribute never gets a location, and the offset reads 0. Keep the declaration qualifier-free.
- Worker/main split: detection runs on both sides (bucket on the worker, variant choice on main). Evaluation is worker-only.

**Tests.**
- `src/style/style_layer/line_style_layer.test.ts` "variable line-offset (line-progress)": `hasVariableOffset` is false for constant, zoom and `get` offsets and true for `interpolate`/`step` on `line-progress`; `offsetExpression` evaluates −10/0/10 at progress 0/0.5/1.
- `test/integration/line-bucket/variable_offset.test.ts`:
  - the shader registers `a_line_offset` as a static attribute;
  - the bucket detects and ignores the right expressions;
  - with clip tags `0..1` the ext buffer is the same length as the layout buffer and bows out past 30 px for a `0→60→0` ramp;
  - a constant offset writes 0.
- `test/integration/render/tests/line-offset/line-progress/style.json`: GeoJSON `lineMetrics: true`, offset −10→10 against a grey reference line. It has **no `expected.png`** in the fork, so it is not a passing render test. Generate one when porting.

**Native porting notes.**
- Likely counterparts:
  - `LineBucket::addFeature` / `addCurrentVertex` / `addPieSliceVertex` (where Native computes `lineSoFar` and clip-based progress for gradients) for per-vertex evaluation;
  - `LineLayoutVertex` / the line-gradient extra attribute (Native packs gradient progress into the main vertex rather than a separate ext buffer, so likely one more float attribute there);
  - `RenderLineLayer::render` for variant selection;
  - `shaders/line.vertex.glsl` (and the generated `line.hpp` program) for the override.
- Native's expression engine exposes `line-progress` through `EvaluationContext` (`lineProgress`). Detect it with `isGlobalPropertyConstant(expr, {"line-progress"})`, or an AST walk like the fork's, on `PropertyExpression::getExpression()`. It is probably better to evaluate through `PropertyExpression::evaluate(zoom, feature, lineProgress)` if that overload exists, or build an `EvaluationContext` by hand.
- Native buckets are built on worker threads too. Evaluation must happen there, with the same "first layer wins" rule, since layers sharing a bucket share vertex data.
- Using a separate shader variant is a GL JS convenience. In Native, a `#define`/permutation of the line program (or a uniform bool selecting the attribute over the paint value) is the natural fit. Keep the same priority order, so pattern/SDF/gradient lines fall back to the paint offset, or decide deliberately to support it there.
- Use global progress (`clipStart + (clipEnd - clipStart) * dist / total`), not the per-tile normalised value Native's gradient path uses.

**Commits.** `f19ffd515` (port), `54e6601b0` (attribute location), `6ce9cbd2a` (evaluation cache).

### Eased `line-offset` on vector tiles, and lines clipped rather than clamped

**Purpose.** Lets a progress-driven `line-offset` work on vector-tile sources, which carry no clip tags. It also keeps a long line that runs past a tile's representable coordinate range straight, where upstream bends it.

**API / style-spec surface.** None new. The change is in how a tile is read.
- A line feature with neither clip tag (`GEOJSONVT_CLIP_START` / `GEOJSONVT_CLIP_END` from `@maplibre/geojson-vt`, i.e. properties `geojsonvt_clip_start` / `geojsonvt_clip_end`; the comment in the fork's test still calls them `mapbox_clip_*`) is treated as a whole line, progress 0..1 over the geometry the tile holds.
- This only applies when the bucket has a variable offset.

**Behaviour.**
- Whole-line fallback: `lineClips = lineFeatureClips(feature) ?? (variableOffsetExpression ? WHOLE_LINE : undefined)`, with `WHOLE_LINE = {start: 0, end: 1}`. Progress therefore runs over the line *as this tile holds it*. That is only the true progress if the tiler ships the line **whole into every tile it touches**, which Parchment's transit tiler does for transition ramps. With an ordinary tiler that clips lines at tile edges, each tile piece would replay the full ramp.
- Side effects of setting `lineClips` (same as upstream for any clipped line):
  - the line's `totalDistance` is measured per line;
  - `lineClipsArray` grows;
  - `linesofar` becomes `scaledDistance * (MAX_LINE_DISTANCE - 1)`, which changes dash/pattern distance encoding for that bucket;
  - the ext buffer is written.
  A constant offset with no tags still produces **no** ext buffer (tested).
- Coordinate-range handling in `loadGeometry`. Representable coordinates are `[MIN, MAX] = [-16384, 16383]` (15 bits).
  - Each point is first scaled to `EXTENT` and rounded, in place.
  - If every point is inside the range, nothing else happens.
  - **Lines** (`feature.type === 2`) with any point outside are *clipped*, not clamped:
    - Each segment is cut to the square `[MIN, MAX]²` with Liang–Barsky: for `(p, q)` in `[(-dx, a.x-MIN), (dx, MAX-a.x), (-dy, a.y-MIN), (dy, MAX-a.y)]`, with `t = q/p`, take `t0 = max` over `p<0` and `t1 = min` over `p>0`. A segment is rejected if `p == 0 && q < 0` or `t0 > t1`.
    - Intersection points are rounded to the integer grid and clamped into range. `t == 0` and `t == 1` return the original endpoints.
    - Consecutive clipped segments are joined while each starts where the last ended. A gap starts a new line, so a line that leaves and re-enters the range splits in two.
    - Parts with fewer than 2 points, and lines entirely outside, are dropped.
    - There is no warning for lines.
  - **Polygons and points** keep upstream behaviour: clamp each coordinate to the range and `warnOnce("Geometry exceeds allowed extent, reduce your vector tile buffer size")`.
- Why clipping matters: a clamped vertex moves, so every segment that reaches it changes direction, including the part inside the visible tile. For an offset ribbon that bend shows as a kink on screen.

**Implementation in GL JS.**
- `src/data/bucket/line_bucket.ts`: the `WHOLE_LINE` constant and the fallback in `addFeature`, plus the per-position evaluation cache (fields `offsetFeature`, `offsetProgress = NaN`, `offsetValue`).
- `src/data/load_geometry.ts`:
  - `loadGeometry` now writes the scaled, rounded coordinates in place and tracks `outside`;
  - new `clipLines(lines)` and `clipSegment(a, b)`, plus the `inRange` helper.
  - It runs on the worker, wherever tile features are loaded. That covers every bucket type, so the clipping applies to all line geometry, not only offset lines.

**Tests.**
- `src/data/load_geometry.test.ts` replaces upstream's "warns and clamps" test with:
  - a line past the range is cut at 16383, not bent;
  - a line that leaves and returns splits in two;
  - a diagonal cut lands on the range corner (`[0,0]→[32766,32766]` becomes `[0,0]→[16383,16383]`);
  - a line entirely outside is dropped;
  - a polygon is still clamped, with exactly one warning.
- `test/integration/line-bucket/variable_offset.test.ts`: "a vector-tile line with no clip tags eases over its own length" (offsets span 0..60 for a 0→60 ramp); "… constant offset gets no progress" (`layoutVertexArray2.length === 0`).

**Native porting notes.**
- Likely counterpart for the fallback: `LineBucket::addFeature`, where Native reads `mapbox_clip_start`/`geojsonvt_clip_start`-style properties to build `lineClips` (check Native's property names; they may differ from GL JS's current geojson-vt).
- Likely counterpart for clipping: the geometry loader, `GeometryTileFeature::getGeometries()` / `VectorTileFeature::getGeometries()` in `vector_tile_data.cpp`. That is where Native scales to `util::EXTENT` and clamps into the int16 range, with a "Geometry exceeds allowed extent" warning.
  - Native stores `GeometryCoordinate` as `int16_t`, so the range is the same.
  - Apply the clip to `FeatureType::LineString` only, and keep the clamp for polygons, whose rings must stay closed.
- Doing the clip in the loader changes all line layers, as in GL JS. Render tests with lines that run far outside the tile may change.

**Commits.** `6ce9cbd2a`.

### `line-rounded-corner-distance`

**Purpose.** Rounds the corners of polygon outlines drawn by a line layer, with the same algorithm and units as upstream's `fill-extrusion-rounded-corner-distance`. An outline drawn over a rounded extrusion (a roof edge) then follows its corners exactly.

**API / style-spec surface.** New **layout** property on line layers, added in `src/style-spec/fork_extensions.ts` to `v8.layout_line`:
- `line-rounded-corner-distance`: `type: number`, `default: 0`, `minimum: 0`, `units: meters`.
- `expression: {interpolated: false, parameters: []}`, i.e. a constant, with no zoom or feature dependence.
- `property-type: data-constant`. No transition, since it is a layout property.
- Doc: "Rounds the corners of polygon outlines by this distance … Has no effect on line geometry."
- `fork_extensions.ts` mutates the shared `v8` singleton at import time. It is imported first by `src/index.ts`, by `src/source/worker.ts` and by `build/generate-style-code.ts`, so validation, parsing and the generated layout-property classes all see it.

**Behaviour.**
- Applies only to features with `type === 3` (polygons) and a truthy distance. LineStrings are left alone.
- The distance is converted once per tile: `getTileUnitsForMeters(m, canonical) = m * meterInMercatorCoordinateUnits(at tile centre) * 2^z * EXTENT`. Rounding happens before line building, so joins, caps and the ext buffer all see the rounded ring.
- Rounding (upstream `round_polygon_corners.ts`, reused unchanged), per ring:
  - Corners adjacent to a tile-boundary edge (`isBoundaryEdge`) are kept sharp, so neighbouring tiles agree.
  - Corners whose edges are nearly straight (`|dot(ua, ub)| > cos 5°`) or degenerate (edge length < 1e-6) are kept sharp.
  - Otherwise the radius is `r = min(d, 0.2*lenA, 0.2*lenB)`.
    - The tangent points sit at `current + u*r`.
    - The arc centre is at `current + normalize(ua+ub) * r / sqrt((1+dot)/2)`.
    - The arc is drawn with `max(2, ceil(|sweep| / 30° - 1e-6))` segments.
  - All vertices are snapped to the integer grid, and duplicates are dropped. A ring that collapses below 3 vertices is returned unchanged. Closed rings stay closed.

**Implementation in GL JS.**
- `src/data/bucket/line_bucket.ts`: new exported `roundOutline(geometry, type, layer, canonical)`, applied in `LineBucket.populate` to each feature's geometry (`roundOutline(needGeometry ? evaluationFeature.geometry : loadGeometry(feature), feature.type, this.layers[0], canonical)`). It imports `roundPolygonCornersIfNeeded` and `getTileUnitsForMeters` from `./round_polygon_corners.ts`.
- Worker only.
- `line_elevation` later reuses `getTileUnitsForMeters`.

**Tests.** `src/data/bucket/line_bucket.test.ts` "roundOutline": a 4096-unit square at z16 with 1.5 m gets more than 5 points. A LineString, or a layer with the property unset, keeps 5.

**Native porting notes.**
- Native does not have `fill-extrusion-rounded-corner-distance` in upstream GL JS's form, so port the rounding helper too (it is small and self-contained). Likely home: `src/mbgl/renderer/buckets/line_bucket.cpp` (`LineBucket::addFeature`, before `addGeometry`), sharing a helper with `FillExtrusionBucket`.
- Add the property to Native's `style-spec` / `v8.json` and regenerate `line_layer_properties`.
- Run it on the worker before line building, using the tile's canonical ID for the metre conversion.

**Commits.** `2d5cf38cf`.


### `symbol-anchor-offset` and `symbol-anchor-offset-alignment`

**Purpose.** Moves a symbol's anchor (icon and text together) by a pixel vector. Unlike `icon-offset` / `text-offset`, the vector is not rotated by `icon-rotate` and not scaled by `icon-size`. With `map` alignment it is a geographic direction: the vector turns with the camera bearing and follows the ground under pitch, while the glyphs keep their own `*-rotation-alignment`. Parchment uses it to hang transit route bullets off an offset ribbon, so the bullets stay on a fixed geographic side of the line while staying upright.

**API / style-spec surface.** Both are layout properties on `symbol` layers. They are added at import time by mutating the style-spec singleton in `src/style-spec/fork_extensions.ts`, which is imported first by `src/index.ts`, `src/source/worker.ts` and `build/generate-style-code.ts`. That file is written to map 1:1 onto a future `v8.json` addition.

| Property | Type | Default | Expression | Property type |
|---|---|---|---|---|
| `symbol-anchor-offset` | `array<number, 2>`, units `pixels` | `[0, 0]` | `interpolated: true`, parameters `zoom`, `feature` | `data-driven` |
| `symbol-anchor-offset-alignment` | enum `map` \| `viewport` | `viewport` | `interpolated: false`, parameters `zoom` | `data-constant`; `requires: ['symbol-anchor-offset']` |

- `map`: +x points east and +y points south.
- `viewport`: +x points right and +y points down, whatever the bearing.
- Neither property is transitionable, since both are layout properties.

**Behaviour.**
- **Evaluation.** The property is evaluated once per feature at the tile's zoom, like every layout property. A zoom expression therefore steps per tile zoom; it does not interpolate continuously.
- **Packing.** Each glyph or icon vertex stores `a_anchoroffset = (round(x*16), round(y*16))` as `Int16 ×2`, in 1/16 px. That gives a range of about ±2048 px at 1/16 px resolution. The shader decodes it as `anchor_shift = a_anchoroffset / 16.0`.
- **Where the shift is added.** In all three symbol vertex shaders, the shift is added in screen (label-plane) pixels after the glyph offset, and outside `rotation_matrix`. That is what keeps it independent of `icon-rotate` and of along-line rotation:
  ```glsl
  finalPos = u_coord_matrix * vec4(projected_pos.xy / projected_pos.w
           + rotation_matrix * (glyph offset terms) * projectionScaling
           + anchor_shift, z, 1.0);
  ```
- **Map alignment, viewport-pitched labels** (`u_anchor_offset_is_map && !u_pitch_with_map`). The shader works out the vector's on-screen direction by projecting a probe point one tile unit along the vector from the anchor, using the same pattern as `u_rotate_symbol`. Tile axes are map-aligned, with +y south:
  ```glsl
  float len = length(anchor_shift);
  if (len > 0.0) {
      vec4 b = projectTileWithElevation(translated_a_pos + anchor_shift / len, ele);
      vec2 sa = projectedPoint.xy / projectedPoint.w;   // anchor, already projected
      vec2 sb = b.xy / b.w;
      float ang = atan((sb.y - sa.y) / u_aspect_ratio, sb.x - sa.x);
      anchor_shift = vec2(cos(ang), -sin(ang)) * len;
  }
  ```
  - The length stays at the authored pixel length. Only the direction comes from the projection, so it tracks both bearing and pitch.
  - With terrain on, the probe uses the anchor's elevation `ele`, so the direction follows the plane at the anchor's height. It does not follow the local slope of the DEM.
- **Pitched labels** (`u_pitch_with_map`). The raw vector is added in the pitched label plane, which is already map-aligned. In that case `map` and `viewport` alignment give the same result, a map-aligned vector.
- **Collision and query boxes.**
  - In `Placement.getBucketParts`, each tile computes a px-to-tile-unit basis:
    ```ts
    anchorOffsetBasis = [
      translatePosition(transform, tile, [1, 0], alignment),
      translatePosition(transform, tile, [0, 1], alignment),
    ]
    ```
    `translatePosition` converts with `pixelsToTileUnits` and, for `viewport`, rotates by `bearingInRadians`. It is the same code as `text-translate-anchor`.
  - In `placeSymbol`, a non-zero `(aox, aoy)` adds `aox*bx + aoy*by` to both `translationText` and `translationIcon`. Every downstream `placeCollisionBox` / circle placement then sees the shifted boxes.
  - Caveat: the collision shift accounts for bearing but not pitch foreshortening. At steep pitch with `map` alignment, the boxes can differ slightly from what the shader draws.

**Implementation in GL JS.**
- `src/style-spec/fork_extensions.ts`: adds the spec entries. Codegen then produces the typed layout properties.
- `src/data/bucket/symbol_attributes.ts`:
  - `symbolLayoutAttributes` gains `a_anchoroffset` (`Int16 ×2`, last member, alignment 4).
  - `symbolInstance` gains `anchorOffsetX` and `anchorOffsetY` (`Float32`, in px) after `heightOffset`.
- `src/data/bucket/symbol_bucket.ts`:
  - `addVertex` takes `anchorOffsetX/Y` and emplaces `round(v*16)`.
  - `addSymbols` evaluates `symbol-anchor-offset` once per feature, from `this.layers[0]` only, and bakes it into every quad vertex.
- `src/symbol/symbol_layout.ts`: `addSymbol` evaluates the property again (default `[0, 0]`) and stores it on the `SymbolInstance` for placement.
- Shaders `symbol_icon.vertex.glsl`, `symbol_sdf.vertex.glsl` and `symbol_text_and_icon.vertex.glsl`:
  - new input `a_anchoroffset`: `location = 6` in icon and SDF, `location = 5` in text-and-icon;
  - new uniform `bool u_anchor_offset_is_map`;
  - the block above, inserted before `finalPos`.
- `src/webgl/program/symbol_program.ts`:
  - `u_anchor_offset_is_map` (`Uniform1i`) is added to all three uniform types.
  - It is the final optional `anchorOffsetIsMap` argument of the three `*UniformValues` builders.
  - Final state: `7ccc7e5a2` later removed the neighbouring `u_height_anchor_ground` uniform, so `anchorOffsetIsMap` now follows `isOffset` directly.
- `src/webgl/draw/draw_symbol.ts`: sets `anchorOffsetIsMap = layout.get('symbol-anchor-offset-alignment') === 'map'` for each layer.
- `src/symbol/placement.ts`: adds `TileLayerParameters.anchorOffsetBasis` and the per-instance translate shift described above.
- Worker and main thread: everything up to and including the vertex data and `SymbolInstance` fields is built on the worker. The basis and the uniform are main-thread work, done each frame or each placement.

**Tests.**
- There is no unit or render test of the shift itself.
- `src/symbol/placement.test.ts` was only updated for the two extra `symbolInstances.emplaceBack` arguments.
- `test-sao.html` in the fork root is a manual visual check page.

**Native porting notes.**
- **Spec.** Add both properties to the Native style-spec / `style/layers/symbol_layer_properties` codegen.
- **Data.**
  - Likely `SymbolSDFIconProgram` / `SymbolLayoutAttributes` gain a `short2` attribute.
  - `SymbolInstance` gains two floats.
  - Evaluate the property in `SymbolLayout::addFeature` / `addSymbol` and `SymbolBucket::addSymbols` (likely).
- **Shaders.** The probe needs the anchor's tile position and a projection function in the symbol vertex shaders. Native's symbol shaders already have the anchor projection that `u_rotate_symbol` uses, so mirror that (likely `shaders/symbol_*.vertex.glsl`, or the Metal/Vulkan equivalents in newer Native).
- **Placement.** Shift the translate vectors in `Placement::placeBucket` / `placeSymbol` (likely), using the same `translatePosition`-style math as `text-translate-anchor`.
- **Zoom behaviour.** The offset is a layout property, so a zoom expression is evaluated at tile zoom. Parchment steps it by zoom band to match that.

**Commits.** `f19ffd515`. The uniform-argument list was reshuffled by `7ccc7e5a2`.

### Isolated collision layers

**Purpose.** Lets named symbol layers declutter only among themselves. Their symbols neither hide, nor are hidden by, any other layer's symbols. Parchment uses it for a layer of small POI dots that thin each other out but must never knock out labels, or be knocked out by them.

**API / style-spec surface.**
- One map constructor option, `MapOptions.isolatedCollisionLayers?: string[]`, default `[]`. It holds layer ids.
- It is stored as `Map._isolatedCollisionLayers: ReadonlySet<string>`.
- There is no setter, no style-spec property and no event. The set is fixed at construction.
- If a layer id in the set does not exist, or a layer is added later under that id, it is simply looked up by id at each placement.

**Behaviour.**
- **Collision groups.** Upstream gives each symbol a collision group, and the `CollisionIndex` predicate decides which already-placed boxes it is tested against. The fork changes how groups are assigned in `CollisionGroups.get(sourceID, layerID)`:
  1. If `layerID` is in the isolated set, the layer gets its own group: `{ID: n, predicate: key => key.collisionGroupID === n}`, where `n = ++maxGroupID`. It is created lazily per layer for the life of the placement.
  2. Otherwise, with `crossSourceCollisions === false`, the source gets its own group, as upstream does. The fork just goes through the same `_next()` helper.
  3. Otherwise the layer uses the shared group, `ID 0`:
     - if the isolated set is empty, the predicate is `null` and the layer collides with everything, exactly as upstream;
     - if the set is non-empty, the predicate is `key => key.collisionGroupID === 0`, so shared symbols ignore boxes from isolated groups.
- **Symmetry.** The rule cuts both ways:
  - isolated symbols are tested only against their own group's boxes;
  - other symbols are tested only against group 0, or their own source group;
  - isolated layers never interact with each other either, since each layer has its own ID.
- **Unaffected.** Fading, cross-tile dedup and `*-allow-overlap` / `*-ignore-placement` behave as before, within each group.
- **Terrain and projection.** No dependence on terrain or projection.

**Implementation in GL JS.**
- `src/ui/map.ts`: reads the option and passes the set as a new last argument of `style._updatePlacement(...)` in `_render`.
- `src/style/style.ts`: `_updatePlacement(transform, showCollisionBoxes, fadeDuration, crossSourceCollisions, forceFullPlacement = false, isolatedCollisionLayers?)` forwards the set to `new PauseablePlacement(...)`.
- `src/style/pauseable_placement.ts`: the constructor takes `isolatedCollisionLayers?` and hands it to `new Placement(...)`.
- `src/symbol/placement.ts`:
  - `CollisionGroups` is now exported and takes `(crossSourceCollisions, isolatedLayers = new Set())`.
  - New fields: `isolatedGroups`, `isolatedLayers`, `shared`.
  - New helper: `_next()`.
  - `getBucketParts` calls `collisionGroups.get(symbolBucket.sourceID, styleLayer.id)`.
- Everything runs on the main thread, in placement.

**Tests.** `src/symbol/placement.test.ts`, `describe('CollisionGroups')`, covers three cases:
- the default is one unfiltered shared group;
- an isolated layer gets a non-zero ID whose predicate excludes group 0, and the shared group's predicate excludes it;
- with cross-source collisions off, per-source groups are kept, and an isolated layer still gets a group distinct from its source's.

**Native porting notes.**
- Native has the same structure: likely `CollisionGroups` in `src/mbgl/text/placement.cpp`, with `Placement::placeBucket` and `CollisionIndex` predicates keyed on `collisionGroupID`.
- Add the layer-id lookup ahead of the source lookup.
- Make the shared group's predicate non-null only when the isolated set is non-empty. That keeps the upstream fast path.
- Expose the set as a `MapOptions` / `Map` setting on the platform SDKs. Native places from `RenderOrchestrator`, so thread the set into the `Placement` constructor from there (likely).

**Commits.** `f19ffd515`.

### How Parchment uses these

- Transit (`services/layers/features/portolan/`):
  - Steady ribbons use a per-feature `["get", "offset_px"]` offset.
  - Transition ramps use `TRANSITION_OFFSET`: `["interpolate", ["cubic-bezier", 0.4, 0, 0.6, 1], ["line-progress"], 0, ["get","off_from_px"], 1, ["get","off_to_px"]]`, wrapped in a zoom-scaled interpolate (×0.5 at z11, ×1 at z14).
  - Both read straight off vector tiles, with no clip tags and no `lineMetrics`. The tiler ships each transition whole into every tile it touches.
  - Because the whole expression is baked at tile zoom, the zoom scaling steps per tile zoom.
- `line-progress` with `lineMetrics: true` GeoJSON is otherwise used only for `line-gradient`/`step` colours (route and guidance lines), which upstream already supports.
- `line-rounded-corner-distance`:
  - the guidance route casing and line use 8 m (`services/guidance/guidance-route-layer.ts`);
  - the building roof-edge outline copies the extrusion's `fill-extrusion-rounded-corner-distance` (`lib/map-style/build.ts`, `withRoundedRoofEdge`).

## Line elevation

With 3D terrain on, upstream drapes every line onto the terrain by drawing it into the terrain's render-to-texture
pass. The fork lets a line layer carry an **elevation profile** per feature: stretches of the line ("runs") given
heights, so bridges sit at their decks and tunnels sink to their bores. A layer with a profile is taken out of the
drape and drawn as real 3D geometry: per-vertex height, depth tested against extrusions and custom layers, with its
underground stretch drawn separately so the terrain over it does not hide it. Everything here is inert with terrain
off: the same layer is then drawn exactly as an ordinary flat line. Parchment uses it for bridge/tunnel cycling ways,
transit ribbons and trip route bands (`lib/map-elevation/elevated-lines.ts`): the vector tiles carry an `elevation`
string property, the layer sets `line-elevation-profile: ["coalesce", ["get", "elevation"], ""]`, ribbons set
`line-pitch-alignment: viewport`, and a dimmed `-ghost` copy of each ribbon sets `line-depth-occlusion-factor: 0` to
show through whatever hides it.

### Elevation profiles (`line-elevation-profile`)

**Purpose.** Raise or sink stretches of a line relative to sea level or to the terrain, and draw the line in 3D instead
of draping it.

**API / style-spec surface.** Added in `src/style-spec/fork_extensions.ts` (which mutates the shared `v8` spec object
at import, before any style-layer property module is generated or loaded; `build/generate-style-code.ts` imports it so
codegen sees the properties):

| Property | Kind | Type | Default | Expression | Notes |
|---|---|---|---|---|---|
| `line-elevation-profile` | layout | string | `""` | `zoom`, `feature`; not interpolated | `property-type: data-driven` |
| `line-depth-occlusion-factor` | paint | number, 0..1 | `1` | `zoom`; not interpolated | `requires: line-elevation-profile`, data-constant, no transition |
| `line-pitch-alignment` | paint | enum `map` \| `viewport` | `map` | `zoom`; not interpolated | see next feature |

Profile string format (parsed by `parseElevationProfile`, `src/data/bucket/line_elevation.ts`):

- Runs are separated by `;`. A run prefixed with `~` is **relative** (heights above the terrain under each point);
  otherwise heights are **absolute** (metres above sea level in the terrain DEM's datum).
- Each run is a comma-separated list of integers, in triples: first triple `lng, lat, h` with lng/lat in **1e-7
  degrees** and h in **decimetres**; each later triple is `dlng, dlat, h` — lng/lat are **deltas** from the previous
  point (accumulated), h is absolute (not a delta).
- A run is skipped if it has fewer than 6 values (two points), a count not divisible by 3, or any non-finite value.
- Points are converted to tile units of the tile being laid out: `x = ((lng+180)/360 · 2^z − tileX) · EXTENT`,
  `y = ((0.5 − ln((1+sinφ)/(1−sinφ))/(4π)) · 2^z − tileY) · EXTENT`, EXTENT = 8192. Being geographic, they survive
  clipping, simplification and re-tiling.
- Example: `0,0,30,450000000,0,30` = two points, (0°,0°) and (45°,0°), both 3.0 m absolute.
  `~0,0,-90,1000,0,-90` = relative run 9 m below ground.

`LineStyleLayer.isElevated()` is true when the profile is data-driven (`!isConstant()`) or a non-empty constant. Only
`layers[0]` of a bucket is read (layers sharing a bucket share layout properties anyway).

**Behaviour.**

1. *Layout (worker), per feature* (`LineBucket.addFeature` → `addLine`): if the bucket is elevated, the profile is
   evaluated for the feature and parsed into runs. The line is subdivided at granularity
   `max(upstream line granularity, ELEVATED_GRANULARITY = 64)` cells per tile, so off the draped texture it still
   follows the terrain between vertices. Then `elevateLine(vertices, runs, reach)` (with
   `reach = ELEVATION_REACH_METERS (4 m) × tile units per metre`) produces new vertices plus per-vertex
   `heights[]` (metres) and `ground[]` (0 or 1):
   - Each run point is placed on the line by `place`: nearest projection onto a segment, searched forward from the
     segment where the previous point of the same run landed (points are expected in line direction), accepted only
     within `SNAP_TOLERANCE = 8` tile units. Points off the line are dropped.
   - Snapping (see "Underground pass and vertex snapping" below): if the projection lies within 8 tile units of a
     segment end it becomes that vertex (t=0 or 1); `t ≥ 1 − 1e-6` is moved to the next vertex with t=0.
   - Placed points are sorted by (segment, t). A point at t ≤ 1e-6 overwrites the vertex's height; otherwise it is
     inserted as a new vertex on the segment.
   - `interpolate`: between two consecutive placed vertices of the **same run**, intermediate vertices get a height
     linearly interpolated by **distance along the line**. No interpolation across two different runs.
   - Vertices still unassigned try `nearestOnRun` (see "Run paths" below); the rest lie on the terrain: height 0,
     ground 1.
   - `ground[i] = 1` for vertices outside any run or in a relative run, `0` for an absolute run.
2. *Per vertex*: the bucket keeps `vertexHeight`, `vertexGround` and a unit **tangent** `(tangentX, tangentY)` =
   `(n.y, −n.x)/|n|` from the extrusion normal (set in `addCurrentVertex` and for round-join fans from the join
   normal). These are written into the ext vertex buffer.
3. *Shader* (all six line vertex shaders, `#ifdef LINE_ELEVATION`):
   `elevation = a_elevation.x · u_terrain_exaggeration + a_elevation.y · get_elevation(pos)` — note the profile height
   is scaled by terrain exaggeration as well, so absolute heights stay consistent with the (exaggerated) DEM.
   `get_elevation` already multiplies the DEM sample by exaggeration. The vertex is projected with
   `projectTileFor3D(edge_pos, elevation)` instead of `projectTile`. Depth is taken from a second projection at
   `elevation + ELEVATION_DEPTH_BIAS (2.0 m)`: `gl_Position = (with_extrude.xy, depth_at.z/depth_at.w · with_extrude.w,
   with_extrude.w)`, pulling the line 2 m toward the camera so the terrain or deck it sits on does not z-fight it.
   Outputs `v_tile_pos` (tile coordinate of the vertex) and `v_lift = elevation − ground`.
   `v_gamma_scale` is computed normally (upstream sets 1.0 under `TERRAIN3D` because the drape mesh handles it; an
   elevated line is not draped, so it computes it).
4. *Fragment* (`elevated_line_fragment` in `_prelude.fragment.glsl`, called first in the five line fragment shaders):
   discard if `v_tile_pos` is outside `[0, 8192]²` — the line is clipped to its own tile in the fragment shader because
   the **stencil clipping mask is disabled** for elevated draws (the mask lies flat at sea level). Underground/overground
   pass discards are described below.
5. *Draping*: `render_to_texture.ts` gets `drapes(layer) = LAYERS_TO_TEXTURES[type] && !layer.isElevated()`; elevated
   line layers are never rendered into the terrain texture, so they reach the painter's normal layer loop.
6. *Draw* (`draw_line.ts`): `linePasses()` returns `['flat']` if the layer is not elevated **or terrain is off**
   (no `LINE_ELEVATION` define, upstream behaviour: heights ignored). Otherwise passes per "Draw order" below. For a
   non-flat pass: stencil `StencilMode.disabled`; defines `#define LINE_ELEVATION` (+ `LINE_VIEWPORT`, + pass define);
   tiles whose bucket has no `layoutVertexBuffer2` are skipped (bucket parsed before the layer got its profile).
7. `line-depth-occlusion-factor`: only `0` vs non-zero matters. `0` → one `'unoccluded'` pass, depth test disabled,
   drawn whole (no underground/overground split) at the deferred overground point, so it paints over 3D features.

Globe: the shaders use `projectTileFor3D`, which has globe and mercator implementations, so it compiles under globe;
nothing else is globe-specific and it is untested there.

**Implementation in GL JS.**
- `src/data/bucket/line_elevation.ts` (new): `ElevationRun`, `parseElevationProfile`, `elevateLine`, `ElevatedLine`.
- `src/data/bucket/line_attributes_ext.ts`: ext layout is now `a_uv_x` F32, `a_split_index` F32, `a_line_offset` F32
  (variable line-offset feature), `a_elevation` F32×4 = (height m, ground factor, tangent.x, tangent.y). 28 bytes/vertex.
- `src/data/bucket/line_bucket.ts`: `elevated`, `elevationRuns`, `vertexHeight`, `vertexGround`, `tangentX/Y`,
  `setTangent()`; the ext array is filled when `lineClips || elevated` (upstream: only with `lineClips`), with
  `uvX = 0` when there are no clips. `elevationRuns` is omitted from worker→main serialisation.
- `src/style/style_layer/line_style_layer.ts`: `isElevated()`.
- Shaders: `line`, `line_gradient`, `line_gradient_sdf`, `line_pattern`, `line_sdf`, `line_variable_offset` vertex;
  `line`, `line_gradient`, `line_gradient_sdf`, `line_pattern`, `line_sdf` fragment; `_prelude.fragment.glsl`.
- `src/webgl/draw/draw_line.ts`: `linePasses`, `LinePass = 'flat'|'underground'|'overground'|'unoccluded'`, defines,
  depth modes, stencil off.
- `src/webgl/render_to_texture.ts`: `drapes()`.
- `src/render/painter.ts`, `src/render/frame_render_context.ts`: draw order (next features).
- Attribute location (`0e74dcf2f`): the first version declared `layout(location = 5) in float a_z;`, which collided
  with paint-property attribute locations; it was changed to no `layout(location)` so the linker assigns it. The final
  `in vec4 a_elevation;` likewise has no explicit location.

**Tests.** `src/data/bucket/line_elevation.test.ts`: parsing (absolute, `~` relative, malformed runs skipped),
`elevateLine` (inserting run points as vertices and interpolating, points off the line ignored, no interpolation
across runs, ground factors, snapping onto vertices, run paths for pieces without points), `LineBucket` packs heights
and tangents into the ext buffer and leaves non-elevated layers with an empty ext buffer. No render tests.

**Native porting notes.**
- Likely counterparts: `LineBucket` (`mbgl/renderer/buckets/line_bucket.cpp`) for layout and a new ext vertex
  attribute set; `RenderLineLayer` for pass selection and depth/stencil modes; the line shader sources in
  `shaders/` (and the generated `programs`/drawable builders on the drawable renderer); the terrain/render-to-texture
  path, if Native has 3D terrain in the target version — verify, since much of this assumes MapLibre GL JS terrain
  (`get_elevation`, `projectTileFor3D`, `u_terrain_exaggeration`).
- The profile is a plain string property: port `parseElevationProfile` and `elevateLine` verbatim; they are pure.
- Tile-space fragment clipping replaces the stencil mask; make sure the stencil is really off for these draws.
- Heights are packed as F32; Native vertex layouts often prefer shorts — keep float precision for metres.
- Elevated buckets subdivide to at least 64 cells per tile, increasing vertex counts.

**Commits.** `d4da4b0d8`, `0e74dcf2f`, `999d1c7bb` (relative runs, ground factor, tangent).

### Datum heights and `line-pitch-alignment`

**Purpose.** Let a profile state heights either in the terrain's own datum (sea level, so a deck is exactly at its
surveyed height regardless of DEM noise) or over the terrain; and let an elevated line keep its pixel width and pixel
offset under a tilted camera, as screen-space transit ribbons need.

**API / style-spec surface.**
- Profile runs: no prefix = absolute (above sea level in the DEM datum); `~` prefix = relative to terrain. In the first
  version (`d4da4b0d8`) all heights were relative; `999d1c7bb` made absolute the default.
- `line-pitch-alignment` (paint, enum `map` | `viewport`, default `map`, `zoom` expressions, not interpolated,
  data-constant, `requires: line-elevation-profile`). Has an effect only on elevated passes.

**Behaviour.**
- Ground factor per vertex: 0 for an absolute run → `elevation = h · exaggeration`; 1 for a relative run or off-run →
  `elevation = h · exaggeration + DEM(pos) · exaggeration`. The DEM is sampled at the vertex centre `pos` (not the
  extruded edge), so both sides of the line share one elevation.
- `map` (default): the extruded edge `edge_pos = line_pos + dist/u_ratio·thickness` is projected in 3D — width and
  offset are in the map plane and shrink with tilt, like a road.
- `viewport` (`#define LINE_VIEWPORT`): the centre `pos + u_translation` is projected at `elevation`, and the combined
  extrusion vector `v = offset2 + dist` (pixels, in tile axes) is re-expressed on screen by
  `viewport_extrusion(centre, elevation, tangent, v, projected)`:
  - `normal = (−tangent.y, tangent.x)`; project `centre + tangent·8` ("ahead") and `centre + normal·8` ("beside"),
    8 tile units, at the same elevation.
  - `along = normalize((ahead − at) · u_viewport_size)` in pixels; `across = perp(along)`, sign-flipped to point the
    same way as `beside − at`.
  - `pixels = dot(v, normal)·across + dot(v, tangent)·along`; returned as a clip-space delta
    `pixels · 2 / u_viewport_size · w`, added to the projected centre.
  - Depth from the centre at `elevation + 2 m`; `v_tile_pos = centre`; `v_gamma_scale = 1.0`.
  - The per-vertex tangent (`a_elevation.zw`) exists for this: the line's screen direction cannot be recovered from
    the extrude normal alone once the line is lifted.

**Implementation in GL JS.** `line_attributes_ext.ts` (`a_z` F32 → `a_elevation` F32×4), `line_bucket.ts`
(`vertexGround`, `setTangent`), `line_elevation.ts` (`relative`, `ground[]`), the six line vertex shaders
(`viewport_extrusion`, `LINE_VIEWPORT` branch), `draw_line.ts` (define from `line-pitch-alignment`),
`fork_extensions.ts`.

**Tests.** `line_elevation.test.ts`: `~` parsing, ground factors per run, tangent packed into ext floats 5–6. No
render test of `viewport`.

**Native porting notes.** The `viewport_extrusion` trick (project two probe points 8 tile units away and rebuild the
screen basis) ports directly to any GLSL/MSL; it needs `u_viewport_size` in pixels. Likely lives in the line vertex
shader and `RenderLineLayer` define selection.

**Commits.** `999d1c7bb`.

### Draw order: underground in place, overground after the last 3D layer

**Purpose.** An elevated line drawn at its normal place in the style is painted over by any 3D layer (extrusions,
3D custom layers) later in the style, and against the terrain's depth its tunnel stretches vanish. The fork splits each
elevated line into an underground pass at its style position and an overground pass deferred until the depth buffer
holds all 3D geometry.

**API / style-spec surface.** None public. `FrameRenderContext.elevatedPass?: 'underground' | 'overground'`
(`src/render/frame_render_context.ts`); unset means "draw both".

**Behaviour.** In `Painter.render`, translucent pass loop (`src/render/painter.ts`):
1. With terrain on, `last3D` = index of the last layer that is visible at the zoom and `is3D()` (upstream's notion:
   fill-extrusion, 3D custom layers); `-1` with terrain off or no 3D layers.
2. For each layer, after the render-to-texture check (elevated lines are not draped, so they get here): if
   `currentLayer < last3D` and the layer is an elevated line, draw it now with `elevatedPass = 'underground'`, push its
   index to `deferred`, and skip the normal draw (and its clipping-mask draw).
3. Right after drawing layer `last3D`, set `elevatedPass = 'overground'` and draw every deferred line in style order,
   with `currentLayer` set to each line's own index (so sublayer depth ranges match), then restore.
4. An elevated line after `last3D` (or with no 3D layers) draws both passes back to back in place.

`linePasses()` in `draw_line.ts`:
- `elevatedPass` set → `[that pass]`; unset → `['underground', 'overground']`.
- `line-depth-occlusion-factor == 0` → `[]` for the underground call, `['unoccluded']` otherwise.

Pass state:

| Pass | Define | Fragment discard | Depth mode |
|---|---|---|---|
| `underground` | `LINE_UNDERGROUND` | `v_lift >= 0` | disabled (no test, no write) |
| `overground` | `LINE_OVERGROUND` | `v_lift < 0` | `LEQUAL`, read-only, `depthRangeFor3D` |
| `unoccluded` | neither | none | disabled |

`v_lift = elevation − DEM(pos)`, i.e. underground means "below the terrain surface here", whatever the datum.
Underground stretches are therefore never hidden by the terrain over them, but extrusions/custom layers later in the
style still paint over them as they would over a draped line. Overground stretches are tested against the depth of the
terrain and of all 3D layers. Neither pass writes depth.

The first version (`cd7a8cfeb`) only deferred the whole line and tested it against depth; `331f48e06` added the
untested underground pass at the style position.

**Implementation in GL JS.** `painter.ts` (the `last3D` / `deferred` block in the layer loop), `frame_render_context.ts`
(`ElevatedPass`), `draw_line.ts` (`linePasses`, depth modes, defines), `_prelude.fragment.glsl`
(`elevated_line_fragment`).

**Tests.** None (no painter or render test covers the ordering).

**Native porting notes.** Likely in `RenderOrchestrator` / the layer render-item loop and `RenderLineLayer::render`
(or the drawable layer group ordering on the drawable renderer, which may make "draw after layer N" a change of
layer-group sort order rather than a loop rewrite). Two draws of one bucket with different defines/depth modes are
needed; under drawables that is two drawables per tile with different shader variants.

**Commits.** `cd7a8cfeb`, `331f48e06`.

### Profile point snapping and run paths

**Purpose.** Keep elevated lines continuous where profile points land just beside an existing vertex (which would
otherwise create a sliver segment that steps in height), and give height to tile pieces that hold no profile point at
all (a long tunnel whose ends both fall in other tiles).

**API / style-spec surface.** None; changes inside `elevateLine`.

**Behaviour.**
- *Snapping* (`331f48e06`): after `place` finds the projection (segment `i`, fraction `t`, segment length `L`), if
  `t·L ≤ 8` tile units the point becomes vertex `i` (t=0); if `(1−t)·L ≤ 8` it becomes vertex `i+1`. Otherwise a new
  vertex is inserted at `t`. A point on a vertex overwrites that vertex's height rather than adding a duplicate.
- *Run paths* (`c72c06fd7`): after placement and interpolation, each vertex still not on a run is tested by
  `nearestOnRun`: over every run, every run segment (consecutive run points, in tile units), the vertex's clamped
  projection onto that segment; the closest one within `reach` wins and the vertex takes the height linearly
  interpolated along that run segment (by the projection fraction, in the run's geometry, not along the line) and
  that run's ground factor. `reach = 4 m` converted to tile units with `getTileUnitsForMeters(1, canonical)` (from the
  fork's round-polygon-corners helper; latitude-aware). Default `reach` when called without it is 8 tile units.
- Consequence: a piece cut from the middle of a run follows the run's interpolated heights; vertices that are merely
  near a run's path pick it up too, even if they lie between two runs' placed points but outside both.
- Earlier behaviour: with no placed points the whole piece was at ground (height 0, ground 1).

**Implementation in GL JS.** `src/data/bucket/line_elevation.ts` (`place`, `elevateLine`, `nearestOnRun`,
`SNAP_TOLERANCE = 8`, `VERTEX_EPSILON = 1e-6`); `line_bucket.ts` (`ELEVATION_REACH_METERS = 4`).

**Tests.** `line_elevation.test.ts`: "a point on a vertex takes it over rather than doubling it", "a point a sliver
from a vertex takes it over", "a piece cut from the middle of a run, holding none of its points, follows its path"
(run −500→2500 with heights −9→−21 gives −11, −15, −19 at x = 0, 1000, 2000).

**Native porting notes.** Pure geometry, worker side: port into the Native line layout alongside `LineBucket`. Note
the cost: `nearestOnRun` is O(vertices × run segments) per feature for unassigned vertices; fine for sparse profiles.

**Commits.** `331f48e06` (snapping), `c72c06fd7` (run paths).

### symbol-height-anchor per feature

**Purpose.** Upstream lets a symbol layer lift its symbols with `symbol-height-offset`, measured either from the terrain or from sea level. The datum (`symbol-height-anchor`) was one value for the whole layer. The fork makes the datum per feature, so one layer can hold some symbols standing on the terrain and others at heights of their own: a station on a viaduct at the height its elevated line is drawn at, next to one at street level. The fork also stops terrain from hiding a symbol that sits *below* the ground surface, such as an underground station.

**API / style-spec surface.**
- Already in upstream v6.11.2 (style-spec ^26.4.4), so the fork does not add these:
  - `symbol-height-offset`: number, metres, data-driven.
  - `symbol-height-anchor`: enum `ground` | `absolute`, default `ground`, `requires: ["symbol-height-offset"]`. At base it is `property-type: data-constant` with `expression.parameters: ["zoom"]`.
- The fork changes `symbol-height-anchor` only. In `src/style-spec/fork_extensions.ts` it overrides the spec entry, and only while upstream still declares it `data-constant`:
  - `property-type: "data-driven"`
  - `expression: {interpolated: false, parameters: ["zoom", "feature"]}`
  - Type, values and default are unchanged. Not interpolated, no transition (it is a layout property).
- No new methods, options or events.

**Behaviour.**
- **Values.** Each feature's anchor is evaluated once, at layout time on the worker, together with `symbol-height-offset`. Ground is stored as `1` for `ground` and `0` for `absolute`.
- **Elevation in the vertex shaders.** All three symbol vertex shaders (`symbol_icon`, `symbol_sdf`, `symbol_text_and_icon`) compute:
  ```glsl
  float ground_ele = get_elevation(a_pos);                         // 0 without terrain
  float ele = a_height_offset.x + a_height_offset.y * ground_ele;  // .x offset m, .y ground flag 0/1
  ```
  This replaces upstream's `a_height_offset + (u_height_anchor_ground ? get_elevation(a_pos) : 0.0)`.
- **Visibility against terrain.** Upstream judges terrain occlusion at the projected (raised) point. The fork judges a symbol below the surface (`ele < ground_ele`) at the point where it stands *on* the surface:
  ```glsl
  float visibility = calculate_visibility(ele < ground_ele
      ? projectTileWithElevation(translated_a_pos, ground_ele) : projectedPoint);
  ```
  - This is the depth-texture terrain occlusion test that `calculate_visibility` does.
  - Without this, an `absolute` symbol whose height is below the terrain at that spot would always be hidden.
  - Symbols at or above the surface behave as upstream.
- **Placement and collision on the CPU.**
  - Each symbol instance's own flag replaces the layer-wide one wherever the elevation is computed:
    - `Placement.placeLayerBucketPart`: `heightAnchorGround = symbolInstance.heightGround === 1`
    - `draw_symbol.ts` `updateVariableAnchorsForBucket`: `heightAnchorGround: symbol.heightGround === 1` on the `SymbolProjectionContext`
  - The flag then feeds upstream's unchanged `getSymbolElevation(getElevation, x, y, heightOffset, heightAnchorGround)`:
    - not ground: returns `heightOffset`
    - ground with no terrain: returns `heightOffset`, or `undefined` when it is 0 (the fast path)
    - ground with terrain: returns `getElevation(x, y) + heightOffset`
  - The CPU collision path has no counterpart to the shader's below-surface visibility rule.
- **Terrain off.** `get_elevation` returns 0, so `ground` and `absolute` give the same result. Globe is not handled specially.

**Implementation in GL JS.**
- **`src/data/bucket/symbol_attributes.ts`**
  - `symbolLayoutAttributes`: `a_height_offset` grows from 1 to 2 Float32 components, `[heightOffset, ground]`. This changes the symbol layout vertex stride. It sits after `a_pos_offset`, `a_data` and `a_pixeloffset` (byte offset 24) and before the fork's `a_anchoroffset`.
  - `placement` (PlacedSymbol) struct: `heightGround: Uint8` added after `heightOffset`.
  - `symbolInstance` struct: `heightGround: Uint8` added at the end, after `anchorOffsetX` and `anchorOffsetY`.
  - The generated struct arrays (`array_types.g.ts`) are regenerated.
- **`src/symbol/symbol_layout.ts`**
  - `addSymbol` evaluates `ground = layout.get('symbol-height-anchor').evaluate(feature, {}, canonical) === 'ground' ? 1 : 0`.
  - It threads `ground` through `addTextVertices` and the icon `addSymbols` calls into `symbolInstances.emplaceBack`.
- **`src/data/bucket/symbol_bucket.ts`**
  - `addVertex` and `addSymbols` take a `ground` argument.
  - The flag is written into every vertex of the quad and into the placed-symbol array.
- **Shaders.** `symbol_icon.vertex.glsl` and `symbol_sdf.vertex.glsl` declare `layout(location = 5) in vec2 a_height_offset`; `symbol_text_and_icon.vertex.glsl` uses location 4. The fork removes the uniform `u_height_anchor_ground` from all three shaders and adds the visibility change above.
- **`src/webgl/program/symbol_program.ts` and `draw_symbol.ts`**
  - `u_height_anchor_ground` is gone from the uniform types, bindings and `*UniformValues` signatures.
  - The `heightAnchorGround` parameters of `drawLayerSymbols`, `updateVariableAnchors` and `updateVariableAnchorsForBucket` are removed.
- **`src/symbol/placement.ts`** reads the flag per instance instead of per layer.
- **Worker vs main thread.** The anchor is evaluated on the worker in layout and travels inside the bucket's struct arrays. Placement (main thread) and the shaders read the stored flag.

**Tests.**
- `src/data/bucket/symbol_bucket.test.ts`: "SymbolBucket measures each symbol's height from the datum its own feature names". The layer is set up with:
  - `symbol-height-anchor: ['case', ['has','z'], 'absolute', 'ground']`
  - `symbol-height-offset: ['coalesce', ['get','z'], 0]`

  The test then asserts:
  - instance `[heightOffset, heightGround]` is `[[24,0],[0,1]]`
  - the vertex float at byte 24 is `[24, 0]`
- `src/symbol/placement.test.ts`: only the `emplaceBack` arity changes.
- No render test covers the below-surface visibility rule.

**Native porting notes.**
- **Data path.** The likely counterparts are `SymbolLayoutProperties` / the generated `symbol_layer_properties` (make `SymbolHeightAnchor` a `DataDrivenLayoutProperty`). Then:
  - `SymbolLayout::addSymbol` / `addSymbolInstance`: evaluate per feature.
  - `SymbolInstance` and `PlacedSymbol`: add a `heightGround` byte.
  - `SymbolBucket` layout vertex: widen the height attribute to vec2.
  - `Placement::placeBucket` / `placeSymbol`: read the per-instance flag.
- **Whether Native has height offsets at all.** Check whether your Native base has `symbol-height-offset` / `symbol-height-anchor` at all. They are recent upstream GL JS additions, so they may need porting first. Port them as upstream defines them, then apply this change.
- **Shaders.** In the symbol shaders (likely `shaders/symbol_*.vertex.glsl` and the generated `programs/symbol_*`, or the drawable shaders in `mbgl/shaders/`), drop the anchor-ground uniform. Mirror the below-surface `calculate_visibility` rule wherever Native tests symbols against the terrain depth.
- **Vertex layout.** The vertex attribute change shifts later attributes (the fork's `a_anchoroffset`). Keep the vertex layout and attribute locations consistent across the three symbol programs.
- **Parchment usage.** Parchment sets `symbol-height-anchor` per feature on the transit station layer (source `portolan-stations`), using `symbol-height-offset` alongside it:
  - A station whose `elevation` property starts with `~` is anchored `ground` (height over the terrain).
  - A plain number is `absolute` (metres in the terrain's datum, matching the line-elevation profiles).
  - A station with no elevation is `ground` with offset 0.

  Stations then sit exactly on their elevated or underground line.

**Commits.** `7ccc7e5a2`

## Symbols and fading

Four small changes to how symbols, lines and circles look as they get far from the camera. One is a precision fix in the SDF label shaders. One is a layer metadata key that turns a symbol layer into "paint on the ground" (`parchment:decal`). One fades lines, symbols and circles out toward the horizon at steep pitch (on by default, with `parchment:horizon-fade: false` to opt a layer out). The last hazes the draped terrain surface into the fog colour over the same distance band. Neither metadata key changes the style spec: both are read from the layer's free-form `metadata` object at draw time, so nothing needs a reload when they are toggled.

### Distant label gamma precision

**Purpose.** With a distant camera (low zoom, steep pitch, or a large `camera_to_center_distance`), SDF text and halos came out blurry or blocky on GPUs where an unqualified `vec3` varying is `mediump`. The fork keeps the gamma inputs at `highp`.

**API / style-spec surface.** None.

**Behaviour.**
- The SDF vertex shader writes `v_data1 = vec3(gamma_scale, size, total_opacity)`, where `gamma_scale = finalPos.w`, the clip-space w, which is the camera-to-vertex distance. That value grows with camera distance. At `mediump`, which is often fp16 (10-bit mantissa, max 65504), it loses precision, and the anti-aliasing width `gamma * gamma_scale` jitters or saturates.
- The fix is qualifiers only. There are no maths changes:
  - `symbol_sdf.vertex.glsl`: `out highp vec3 v_data1;`
  - `symbol_sdf.fragment.glsl`: `in highp vec3 v_data1;`, `highp float gamma_scale = v_data1.x;`, and `highp` on `gamma_halo` and `inner_edge_halo`. `gamma_halo = (halo_blur * 1.19 / SDF_PX + EDGE_GAMMA) / (fontScale * u_gamma_scale)` is a reciprocal-like quantity that also overflows `mediump`.
  - `symbol_text_and_icon.vertex.glsl` / `.fragment.glsl`: `out/in highp vec3 v_data1;`, `highp float gamma_scale = v_data1.x;`.
- `u_gamma_scale` was already `highp` upstream.

**Implementation in GL JS.** Only the four shader files above.

**Tests.** `test/integration/shaders/symbol-precision.test.ts` asserts that the compiled (minified) shader strings contain `out highp vec3 v_data1;`, `in highp vec3 v_data1;`, `highp float gamma_scale=v_data1.x;` and `highp float gamma_halo=`, for both the SDF and the text-and-icon programs.

**Native porting notes.**
- The likely counterparts are `shaders/symbol_sdf.{vertex,fragment}.glsl` and `symbol_text_and_icon` in MapLibre Native's shader sources, plus the generated GLSL ES shader headers. On the Metal and Vulkan backends, the likely counterparts are the per-backend shader headers (`include/mbgl/shaders/{mtl,vulkan}/symbol*.hpp`).
- On Metal, check that the varying and the locals are `float`, not `half`.
- This matters most on mobile GPUs. Mali and Adreno really do run `mediump` as fp16, while desktop GPUs usually promote it to fp32. That is why the bug hides on desktop.

**Commits.** `c2c4a76cd` (merged through fork PR #1).

### Decal icons (`parchment:decal`)

**Purpose.** Some symbol layers are paint on the road surface: arrows, bike glyphs. In a layer marked as a decal, icons shrink with distance exactly as the map does, with no perspective size compensation.

**API / style-spec surface.** Layer metadata key `parchment:decal`. Any truthy value enables it; it is off when absent. It is read at draw time. There is no spec property.

**Behaviour.**
- Upstream symbol shaders scale `size` by a perspective ratio:
  - `distance_ratio = pitchWithMap ? camToAnchor / camToCenter : camToCenter / camToAnchor`
  - `perspective_ratio = clamp(0.5 + 0.5 * distance_ratio, 0.0, 4.0)`
  - `size *= perspective_ratio` unless `u_is_offset` is true.
- Upstream sets `u_is_offset` when the layer has a value for `icon-offset`. The fork also sets it when the layer is a decal: `isOffset = layer._unevaluatedLayout.hasValue('icon-offset') || isDecal`.
- With `icon-pitch-alignment: map`, skipping the ratio gives true perspective: the icon behaves like a texture on the ground plane.
- The uniform goes to every symbol program the layer draws (icon, SDF, text-and-icon). So text in a decal layer also loses the boost, just as upstream already does for text in a layer with `icon-offset`.
- Collision and placement are unchanged. In practice decal layers use `icon-allow-overlap` and `icon-ignore-placement`.
- Behaviour is the same with terrain on or off, and on globe or mercator.

**Implementation in GL JS.** `src/webgl/draw/draw_symbol.ts`, `drawLayerSymbols`: computes `isDecal` from `layer.metadata['parchment:decal']` and ORs it into `isOffset`, which feeds `u_is_offset` through `symbolIconUniformValues`, `symbolSDFUniformValues` and `symbolTextAndIconUniformValues`. There are no shader changes.

**Tests.** None.

**Native porting notes.**
- Likely counterpart: `RenderSymbolLayer` (`render_symbol_layer.cpp`) or the drawable or tweaker that sets the symbol uniforms (`SymbolLayerTweaker`, `is_offset`).
- Native style layers keep `metadata` as a JSON value (`Layer::getMetadata()` / `setMetadata`, likely). Read the key there.
- Check how Native computes its equivalent of `u_is_offset`. Older Native builds may not have the `icon-offset` exemption at all. If so, add the uniform or flag and the `if (!is_offset) size *= perspective_ratio` guard in the three symbol vertex shaders.

**Commits.** `bd140a8a2`.

**Use in Parchment.** The road glyph layer (lane arrows, bike and walker symbols) sets `metadata: {'parchment:decal': true}`. It also uses `icon-rotation-alignment: map` and `icon-pitch-alignment: map`, and an `icon-size` that is metres converted to pixels by zoom.

### Horizon fade for lines, symbols and circles (`parchment:horizon-fade`)

**Purpose.** At steep pitch, far features pile up along the horizon into a dense band. Lines, symbols and circles now fade to transparent with distance from the camera.

**API / style-spec surface.**
- On by default for every `line`, `symbol` and `circle` layer.
- Layer metadata `parchment:horizon-fade` set to exactly `false` (strict `=== false`) opts the layer out. Any other value, or none, leaves the fade on.
- Fills, fill-extrusions, rasters, hillshade and heatmaps are never faded. The terrain surface gets its own haze (next section).
- No spec property, no map option.

**Behaviour.**
- The shared function, defined in both the vertex and the fragment prelude under `#ifdef HORIZON_FADE`:
  ```glsl
  float horizon_fade(highp float depth) {
      return 1.0 - smoothstep(2.5, 5.0, depth / u_camera_to_center_distance);
  }
  ```
  `depth` is the camera-to-point distance, as clip-space w, in the same units as `u_camera_to_center_distance` from `FrameUBO`.
- The fade is 1 up to 2.5 times the distance from the camera to the map centre. It eases with a smoothstep to 0 at 5 times that distance. Only steep pitch reaches those distances, so a flat map or modest pitch is visually unchanged.
- Constants: 2.5 and 5.0, hardcoded.
- **Lines** fade per fragment. These shaders get it: `line`, `line_gradient`, `line_gradient_sdf`, `line_pattern`, `line_sdf`, and the variable-offset variant through `line.fragment`. After the colour is computed and before `OVERDRAW_INSPECTOR`, they do `fragColor *= horizon_fade(1.0 / gl_FragCoord.w)`. Colours are premultiplied, so all four channels are scaled.
- **Symbols** fade per vertex, from the anchor's projected point, in `symbol_icon`, `symbol_sdf` and `symbol_text_and_icon`:
  - `total_opacity *= horizon_fade(projectedPoint.w)` (`v_total_opacity` in the icon shader).
  - This happens before the existing `if (total_opacity < 0.1)` early-out, which moves the vertex out of clip space. So a symbol is discarded once the fade drops it below 0.1, which happens at about 4.6 times the centre distance.
  - The fade does not affect placement or collision: faded symbols still occupy collision space.
- **Circles** fade per vertex, from the projected circle centre: `v_visibility *= horizon_fade(projected_center.w)`. `v_visibility` is a flat varying that multiplies the fragment colour.
- **Terrain.**
  - With terrain on, flat lines are drawn into the render-to-texture drape. That pass is an orthographic tile render, so `gl_FragCoord.w` there is 1, the fade is about 1, and draped lines do not fade by themselves (inferred from the RTT projection). The terrain haze covers them.
  - Lines drawn in 3D (elevated lines, see Line elevation) and symbols and circles projected with elevation do fade.
- **Globe.** The function is used as is, with no globe special case.

**Implementation in GL JS.**
- `src/webgl/draw/horizon_fade.ts` (new) exports `horizonFadeDefines(layer)`. It returns `[]` when `layer.metadata['parchment:horizon-fade'] === false`, and `['#define HORIZON_FADE']` otherwise.
- These calls pass it as the extra defines argument of `painter.useProgram(name, programConfiguration, false, defines)`:
  - `draw_line.ts`, `drawLineTiles`, combined with the `LINE_ELEVATION`, `LINE_VIEWPORT`, `LINE_UNDERGROUND` and `LINE_OVERGROUND` defines.
  - `draw_symbol.ts`, `drawLayerSymbols`.
  - `draw_circle.ts`, `drawCircles`.
- Shaders: `_prelude.vertex.glsl` and `_prelude.fragment.glsl` get `horizon_fade()`. The fragment prelude already declares `FrameUBO` with `u_camera_to_center_distance`. The call sites are the per-shader lines quoted above.
- A different define set means a separate compiled program variant per layer kind.

**Tests.** None in the fork.

**Native porting notes.**
- Likely counterparts:
  - The line, symbol and circle shaders in Native's shader sources, including the Metal and Vulkan headers.
  - `RenderLineLayer`, `RenderSymbolLayer` and `RenderCircleLayer`, or their layer tweakers and drawable builders, to pick a shader variant or set a uniform.
- Native shader variants are usually selected with property-based defines or a uniform bool. A uniform `u_horizon_fade` (0 or 1) avoids doubling the program count. Then evaluate `mix(1.0, horizon_fade(...), u_horizon_fade)`.
- Check that Native's global or frame uniform block exposes the camera-to-centre distance to fragment shaders. It does for symbols (likely), but perhaps not to the line fragment stage.
- On Metal, `gl_FragCoord.w` corresponds to `position.w` in `[[position]]`, which holds 1/w as in GL. Confirm this per backend, or pass a varying with clip w from the vertex stage instead. The varying is the more portable choice.
- Keep `depth` and the division at `highp`/`float`: clip w can exceed the fp16 range at distance.

**Commits.** `78b35b1d6`.

**Use in Parchment.** The app sets no `parchment:horizon-fade` key, so every line, symbol and circle layer fades.

### Terrain haze over the horizon-fade band

**Purpose.** With terrain on, flat lines are baked into the draped texture and cannot fade by themselves. Instead, the whole draped ground surface mixes into the fog colour over the same distance band.

**API / style-spec surface.**
- No new properties. The haze is always on whenever terrain is drawn, with no opt-out.
- The colour comes from the existing sky property `fog-color`, or white when the style has no sky.

**Behaviour.**
- The last line of `terrain.fragment.glsl` is new. It runs after the existing fog and horizon blend, so it is applied on top of it:
  ```glsl
  fragColor = mix(u_fog_color, fragColor, horizon_fade(1.0 / gl_FragCoord.w));
  ```
- That gives full surface colour up to 2.5 times the camera-to-centre distance and pure `u_fog_color` from 5 times.
- The mix is in gamma space and includes alpha: `u_fog_color` alpha replaces the surface alpha at the far end.
- The upstream fog block is skipped in globe mode, but this line is not. It applies in globe mode too.
- The haze also applies under the fork's shading. The `SHADING` ground shade is applied to `surface_color` before fog, so shaded ground hazes too.
- Not applied to the depth or coords passes of terrain, only to the colour pass.

**Implementation in GL JS.**
- `src/webgl/draw/draw_terrain.ts`, `drawTerrain`: `painter.useProgram('terrain', null, false, ['#define HORIZON_FADE'])`. The terrain colour program always compiles with the define. The shading commit later adds `SHADING` defines alongside it.
- `src/shaders/glsl/terrain.fragment.glsl`: the mix line above. `horizon_fade()` comes from the fragment prelude.

**Tests.** None.

**Native porting notes.**
- Likely counterparts: Native's terrain or "draped" surface rendering. In Native that is the render-to-texture or terrain drape path if your fork has 3D terrain. Upstream MapLibre Native has no 3D terrain, so this lands wherever the terrain port draws the draped mesh.
- If Native has no terrain, skip this. Without terrain, flat lines are drawn directly in 3D and fade per fragment through the line change above.
- The same fp16 caution applies to `depth / camToCenter`.

**Commits.** `0cb012c9c`.

**Dependencies.**
- Terrain haze depends on the horizon-fade prelude function from `78b35b1d6`.
- Horizon fade's line call sites share the define list with Line elevation's `LINE_*` defines (`draw_line.ts`). Port it after, or alongside, line elevation if that is ported.
- Decal icons and gamma precision are independent.

## Terrain and draping

These changes touch how the map draws over 3D terrain (`map.setTerrain`). They cover how draped layers are
batched into terrain textures, where DEM tiles are decoded, how per-tile elevation ranges are cached, and how
fill-extrusion buildings find the ground they stand on. Only `drapeBeneath` adds API. The rest change behaviour
behind the existing terrain API. Before porting, check whether the MapLibre Native fork renders 3D terrain at
all: upstream Native historically had hillshade but no draped 3D terrain mesh or render-to-texture path. If it
has none, the draping items below only apply once terrain itself has been ported.

### Drape beneath (`drapeBeneath` map option)

**Purpose.** Over terrain, every background, fill, line, raster, hillshade and color-relief layer goes into a
single draped texture, drawn beneath every other layer. Without it there is one texture and one terrain-mesh pass
per run of such layers between other layers. A style that interleaves symbols, circles or extrusions with
lines and fills pays for that many terrain passes. With this option it pays for one.

**API / style-spec surface.**
- `MapOptions.drapeBeneath?: boolean`, default `false`. It is read once, when terrain is enabled, and passed to
  the `RenderToTexture` constructor: `new RenderToTexture(painter, terrain, drapeBeneath)`.
- `IRenderToTexture.drapeBeneath` is a `readonly boolean`. The mode is fixed when the object is built. To
  change it you have to rebuild the map, or turn terrain off and on again.
- No style-spec change.

**Behaviour.**
- Draped layer types (`LAYERS_TO_TEXTURES`): `background`, `fill`, `line`, `raster`, `hillshade`,
  `color-relief`. A line layer with an elevation profile (`isElevated()`, see Line elevation) is not draped.
  The helper `drapes(layer)` combines both rules.
- Each frame, `prepareForRender` builds `_renderableLayerIds`: style order, minus muted layers and layers outside
  their zoom range. With `drapeBeneath` it also builds `_drapedLayerIds`, which is that list filtered by
  `drapes()`, still in style order.
- **Fingerprinting rule.** Each terrain tile's texture is cached against an `RTTFingerprint`. The fingerprint
  holds the source tiles under it, the source revision, the zoom, and `visibleLayerIds`, the list of visible
  layer ids joined into a string. With `drapeBeneath`, `visibleLayerIds` is built from `_drapedLayerIds` only.
  So a label or circle entering or leaving its zoom range does not invalidate the draped texture. Without the
  option the full renderable list is used, as upstream does. All other cache and refresh rules are unchanged
  from upstream:
  - A change that is only the zoom is kept while moving, then re-rendered one tile per frame.
  - A change in source tiles is re-rendered one tile per frame.
  - A change in visible layers waits while the zoom changes, then re-renders everything at once.
  - A source data change re-renders immediately.
  - `needsFollowUpFrame` covers the rest.
- **When the draping happens.** In the translucent pass, `renderLayer` is called for each layer in style order.
  On the first visible layer of the frame, whatever its type, with `_stacks` empty and `_drapedLayerIds`
  non-empty, it does two things:
  - pushes `_drapedLayerIds` as the only stack;
  - calls `_renderStack`, which renders the stack into each renderable terrain tile's texture where there is no
    cache hit, then calls `drawTerrain` once.

  `renderLayer` then returns `true` for draped layers (the painter skips them) and `false` for all others (the
  painter draws them normally, on top). Draping on the first visible layer, not the first draped layer, means
  nothing gets drawn under the terrain pass.
- If no layer is draped, there is no stack and no terrain pass. The terrain mesh is not drawn at all.
- Effect: symbols, circles, fill-extrusions, custom layers and elevated lines all draw above all of the draped
  ground, regardless of where they sit in the style.
- Terrain off: the option has no effect, because `RenderToTexture` only exists with terrain. Globe: same code
  path, nothing globe-specific.

**Implementation in GL JS.**
- `src/webgl/render_to_texture.ts`:
  - new `drapeBeneath` and `_drapedLayerIds` fields;
  - `prepareForRender` filters the draped ids and uses them for `visibleLayerIds`;
  - `renderLayer` has the early `_drapedLayerIds` branch;
  - stack rendering is factored out into `_renderStack(renderContext)`, which the normal per-run path also uses.
- `src/render/render_to_texture_interface.ts` adds the field to the interface.
- `src/ui/map.ts`: the option, its default, `_drapeBeneath`, and passing it to the constructor in `setTerrain`.

**Tests.** `src/webgl/render_to_texture.test.ts`, `describe('draped beneath')`:
- one stack and one terrain pass beneath interleaved symbols;
- the texture is kept from frame to frame, and when only a label enters its zoom range;
- nothing is drawn on the terrain when no layer is draped.

`map_render.test.ts` only adds the field to a mock.

**Native porting notes.** The likely counterpart is wherever Native's terrain port draws draped layers into
per-tile render targets: an RTT or "drape" pass in `RenderOrchestrator` / `RenderTree`, plus the layer-group
ordering. In upstream Native the render-pass order is built in `RenderOrchestrator::createRenderTree`. The port
amounts to these steps:
1. collect the draped layers once per frame;
2. key texture cache invalidation on the draped layers' visibility only;
3. emit the drape and terrain draw before the first visible layer's render item.

A map option on `MapOptions` or the renderer frontend fits. Keep it immutable after terrain creation, as GL JS
does. Nothing here is specific to the web.

**Parchment usage.** `drapeBeneath: true` is set in the MapLibre map options in
`services/map/providers/maplibre.strategy.ts`.

**Commits.** `763f20689`, `4a3ef5414`.

### Terrain worker (DEM decodes on a dedicated worker)

**Purpose.** Terrain under the camera waits for DEM tiles to decode. When those decodes share workers with vector
tile parsing, a DEM decode can sit behind a long parse that is already running. The fork gives DEM decodes a
worker of their own.

**API / style-spec surface.** None public. Internal additions:
- `WorkerPool.acquireTerrain(): Promise<ActorTarget>` and the field `WorkerPool.terrainWorkerPromise`;
- `Dispatcher.getTerrainActor(): Promise<Actor>`.

**Behaviour (final state).**
- `WorkerPool` keeps **one** extra worker for terrain, apart from the tile workers. It is created lazily
  (`terrainWorkerPromise ||= workerFactory()`) and shared by every map that uses the pool.
- `WorkerPool.release(mapId)`: when the last map is released (`numActive() === 0`), the terrain worker is
  terminated along with the tile workers. If any map is still active, nothing is torn down.
- `Dispatcher.getTerrainActor()`:
  - rejects with `Error('Dispatcher removed')` once the dispatcher is removed, and then never acquires a worker;
  - otherwise memoises one `Actor` over the terrain worker, with `actor.name = 'Terrain worker'`;
  - subscribes to the worker's `error` event and fires the same `ErrorEvent` ("Worker failed to load. Check that
    the worker URL is correct.") that the tile workers fire.
- `Dispatcher.remove(mapRemoved = true)`: if a terrain actor exists, it sends `MessageType.removeMap` (when
  `mapRemoved`) and errors from that send are swallowed. Then it calls `actor.remove()` and clears the memo.
- `RasterDEMTileSource`:
  - `onAdd` warms the worker with `this.dispatcher.getTerrainActor().catch(() => {})`, so the first tile does not
    wait for the worker to boot;
  - `loadTile` assigns `tile.actor = await this.dispatcher.getTerrainActor()` (replacing `waitForInitComplete()` +
    `getReadyActor()`) and sends `loadDEMTile` on it. A tile that already has an actor and is not
    expired/reloading keeps that actor, as before.
- Superseded attempt, absent from the final code: commits `709b68c21` and `79f332311` made `Actor` queue
  `loadDEMTile` tasks ahead of other queued tasks, keeping arrival order among DEM tasks. `ef22fff32` removed this
  once DEM decodes had their own worker and that queue sat idle. **Do not port the queue.**

**Implementation in GL JS.**
- `src/util/worker_pool.ts` (`acquireTerrain`, `release`);
- `src/util/dispatcher.ts` (`getTerrainActor`, `remove`);
- `src/source/raster_dem_tile_source.ts` (`onAdd`, `loadTile`);
- `src/util/test/util.ts`: the mock dispatcher gains `getTerrainActor`.

**Tests.**
- `src/util/worker_pool.test.ts`: one terrain worker, kept apart from the tile workers and ended with the pool.
- `src/util/dispatcher.test.ts`: terrain goes to its own worker, which is told `RM` when the map is removed; a
  removed dispatcher starts no terrain worker.
- `src/source/raster_dem_tile_source.test.ts`: a tile is decoded on the terrain actor.

**Native porting notes.** Native has no web workers. Tile workers are `Actor<…TileWorker>` objects on a shared
`Scheduler` / thread pool. Likely counterparts are `RasterDEMTile` / `RasterDEMTileWorker` and
`Scheduler::GetBackground()`. The equivalent change is to run DEM decoding on its own dedicated single-thread
scheduler, or a high-priority queue, instead of the shared background pool. That way a long vector-tile parse on
the pool cannot delay it. Create it lazily, and destroy it with the last map, or keep it process-wide. Decoding
DEM is cheap (unpacking RGB to elevations plus the border backfill). What matters is the latency, not the
throughput.

**Commits.** `d77e044c2` and `ef22fff32` (final). The superseded queue is `709b68c21` and `79f332311`.

### Per-frame elevation-range cache

**Purpose.** Every source's tile cover asks `Terrain.getMinMaxElevation(tileID)` for the same tiles each frame.
Each call walks parents to find the DEM tile. The fork caches the answer for one frame.

**API / style-spec surface.** Internal only: `Terrain._minMaxCache: Map<string, {minElevation, maxElevation}>`
and `Terrain.beginFrame()`.

**Behaviour.**
- `getMinMaxElevation` memoises its result by `tileID.key`. The result is `{minElevation: dem.min *
  exaggeration, maxElevation: dem.max * exaggeration}`, or `{null, null}` when there is no DEM.
- The cache also stores the `null`/`null` "no DEM" result. Because it is cleared every frame, a DEM that loads
  later is picked up on the next frame.
- `Map._render` calls `this.terrain?.beginFrame?.()` before drawing, which clears the cache. The reason given is
  that a DEM tile may load, or be edited in place, between two frames.
- Callers are the mercator and globe covering-tiles detail providers and `Terrain` itself.

**Implementation in GL JS.** `src/render/terrain.ts` (`getMinMaxElevation`, `beginFrame`) and `src/ui/map.ts`
(`_render`).

**Tests.** None specific.

**Native porting notes.** This only matters if Native's covering-tiles logic queries per-tile terrain bounds.
Cache per frame in the terrain object and clear it at the start of `RenderOrchestrator::createRenderTree` (likely
the spot).

**Commits.** `6278321dc` (the `terrain.ts` / `map.ts` part).

### Building ground elevation from a CPU-computed buffer, at a tile-agreed anchor

**Purpose.** Under 3D terrain, each fill-extrusion polygon stands at one ground elevation. Every tile that holds
a piece of the building agrees on that elevation, so copies across a tile border line up. It is the **lowest**
ground under the footprint, so a building on a slope does not float. The elevation is computed on the CPU once
per (bucket, DEM) and uploaded as a per-vertex attribute. It is no longer sampled from the DEM texture for every
vertex on every frame.

**API / style-spec surface.** None public. Internal additions:
- `Terrain.getAnchorElevations(bucket, tileID): VertexBuffer`;
- `Terrain.getTileElevationReader(tileID)`;
- `FillExtrusionBucket.updateAnchorElevations(context, key, reader)`;
- `DEMData.sampleBilinearClamped(x, y)`;
- `Tile.demRevision`.

The bucket's `centroidVertexArray` now holds **terrain anchors** instead of vertex-average centroids.

**Behaviour.**

1. **Ownership and dropping (worker, always, terrain on or off).** For each polygon from
   `classifyRings(geometry, EARCUT_MAX_RINGS)`, `terrainAnchor(polygon)` computes the polygon's bounding box (in
   tile units, `EXTENT = 8192`) and its centre `(x, y)`. If the box is empty, or the centre lies outside
   `[0, EXTENT)` on either axis, the function returns `null` and **the polygon is not added to this tile at
   all**. Each tile's own clipped piece is judged on its own clipped bounds. The rule assumes the tile buffer
   holds the building, so that exactly one tile's piece has its centre inside that tile. This changes what is
   drawn even without terrain: duplicate border pieces disappear.

2. **Anchor point.** Let `GRID = 8`, `snapped(v) = max(0, floor(v/8)*8)`, and
   `reach(half) = half <= 8 ? 0 : clamp(ceil(log2(half/8)), 1, 7)`. `reach` is the 3-bit exponent of a power of
   two that covers a half-extent.
   - For each of the four tile edges (`x=0`, `x=EXTENT`, `y=0`, `y=EXTENT`) that the box straddles strictly
     (`west < edge < east`, or the same for north/south), intersect every ring segment with the edge. Keep the
     span `[low, high]` of the crossings, then keep the widest cut per orientation: one for vertical edges and
     one for horizontal edges. Each kept cut records its `span`, `edge` and `middle = (low+high)/2`.
   - If it is cut by both a vertical and a horizontal edge, the anchor is `{x: vEdge, y: hEdge}`, the corner,
     with no reach bits.
   - If it is cut by a vertical edge only, the anchor is `{x: vEdge, y: snapped(vMiddle) + reach(vSpan/2)}`.
   - If it is cut by a horizontal edge only, the anchor is `{x: snapped(hMiddle) + reach(hSpan/2), y: hEdge}`.
   - Otherwise the anchor is `{x: snapped(cx) + reach((east-west)/2), y: snapped(cy) + reach((south-north)/2)}`.
   - Edge coordinates (0 and 8192) are multiples of 8, so their low bits read as reach 0. The neighbouring tile's
     piece anchors at the same geographic point: its `EXTENT` edge is this tile's `0` edge, and the middle along
     the shared edge is the same. Both pieces therefore get the same elevation.
   - The anchor is stored as `Int16` `(floor(x), floor(y))` in `centroidVertexArray`, once per vertex of the
     polygon.

3. **Elevation at the anchor (main thread).** `anchorElevation(x, y, elevationAt)`:
   - Compute `px = floor(x/8)*8`, `py = floor(y/8)*8`, and the codes `cx = x-px`, `cy = y-py`.
   - Compute the reaches: `rx = cx < 0.5 ? 0 : 8 * 2^cx`, and the same for `ry`.
   - The result is `min(elevationAt(px,py))`. If `rx || ry`, it also takes the min over the four corners
     `(px±rx, py±ry)`. That is up to 5 samples.
   - `elevationAt` is `Terrain.getTileElevationReader(tileID)`. The reader uses the one DEM source tile the tile
     is drawn with (`getSourceTile(tileID, true)`) and that tile's DEM matrix (`_getDEMTileMatrix`). It maps tile
     units to DEM pixels as `x*matrix[0]*dim + matrix[12]*dim + DEM_CELL_CENTER_OFFSET`, and the same for y with
     `[5]`/`[13]`. It reads `dem.sampleBilinearClamped(...) * exaggeration`. Clamping is to
     `[-1, dim - 1e-3]`, which matches the GPU texture's `CLAMP_TO_EDGE` in the shader's `get_elevation`.
   - The reader returns `null` while no DEM is loaded. In that case the reader used is `() => 0`.

4. **Caching.** `updateAnchorElevations(context, key, reader)` recomputes only when `key` changes. The key is
   ``${sourceTile.uid}:${sourceTile.demRevision}:${exaggeration}``, where `sourceTile =
   getTerrainData(tileID).tile`. Consecutive vertices that share an anchor reuse the last value. The result is
   written into a `StructArrayLayout1f4` (`a_anchor_elevation`, Float32 ×1) and uploaded as a dynamic vertex
   buffer, through `updateData` on later updates. `Tile.demRevision` is incremented each time the DEM texture is
   uploaded afresh (the `needsTerrainPrepare` branch in `Terrain.getTerrainData`). That covers DEM reloads and
   in-place edits.

5. **Shader.**
   - `fill_extrusion.vertex.glsl` and `fill_extrusion_pattern.vertex.glsl`, under `#ifdef TERRAIN3D`, replace
     `layout(location = 2) in vec2 a_centroid` with `layout(location = 2) in float a_anchor_elevation`.
   - `get_elevation(a_centroid)` becomes `height_terrain3d_offset = a_anchor_elevation`.
   - The unchanged upstream logic follows: `base_terrain3d_offset = height_terrain3d_offset - (base > 0 ? 0 :
     10)`, a 10 m "basement".
   - `draw_fill_extrusion.ts` passes `painter.style.map.terrain?.getAnchorElevations(bucket, coord)` as the
     dynamic buffer instead of `bucket.centroidVertexBuffer`.
   - Terrain off: no buffer is bound and `TERRAIN3D` is off.
   - Globe: same path. No globe-specific change, and the upstream globe pole guard in `get_elevation` no longer
     applies to extrusions.

**Relation to Parchment's postinstall patch.**

On the `dev` branch, `web/scripts/patch-maplibre-terrain.mjs` rewrites the built `dist/` files:
- (a) In `FillExtrusionBucket.addFeature`, it computes exactly the `terrainAnchor` above. That includes the
  `continue` that drops a polygon whose bbox centre lies outside the tile, the edge/corner anchors, and the 8-unit
  snap with 3-bit log2 reach. It writes the anchor into `centroidVertexArray` in place of the centroid.
- (b) In both extrusion vertex shaders, it replaces `get_elevation(a_centroid)` with a GLSL
  `anchor_elevation(a_centroid)`: the min of `get_elevation` at the snapped point and the four `±reach` corners.
  That is five DEM samples per vertex per frame.

`43e498a61` absorbs **all** of it:
- (a) becomes `fill_extrusion_anchor.ts` `terrainAnchor`, with the same constants and rules;
- (b) becomes `anchorElevation` on the CPU, with the same five-point min, and the result reaches the shader as
  `a_anchor_elevation`.

The only difference in behaviour is when the elevation is evaluated: once per DEM revision on the CPU instead of
every frame on the GPU. The values match, because the clamped bilinear sample mirrors the shader's. **Nothing in
the patch remains a behaviour change outside the fork**, so a Native port needs only what is described above.

On the `map-performance` branch, the app has dropped the patch, and the fork's own build would break it: it
anchors on `a_centroid` declarations that no longer exist. On `dev`, the patch is still present against an older
fork tag (`…terrain.1`). Upgrading `dev` to `terrain.4` or later requires removing the patch, or the install
fails.

**Implementation in GL JS.**
- `src/data/bucket/fill_extrusion_anchor.ts` (new): `terrainAnchor`, `anchorElevation`.
- `src/data/bucket/fill_extrusion_attributes.ts`: `anchorElevationAttributes`.
- `src/data/bucket/fill_extrusion_bucket.ts`: `addFeature` and `updateAnchorElevations`, plus the
  `anchorElevationArray/Buffer/Key` fields.
- `src/data/dem_data.ts`: `sampleBilinearClamped`.
- `src/render/terrain.ts`: `getTileElevationReader`, `getAnchorElevations`, and the `demRevision++` bump.
- `src/tile/tile.ts`: `demRevision`.
- The two shaders, and `src/webgl/draw/draw_fill_extrusion.ts`.

Split between threads: the anchors are computed on the worker during bucket building. The elevation buffer is
computed lazily on the main thread at draw time.

**Tests.** `src/data/bucket/fill_extrusion_anchor.test.ts`:
- the anchor at the bounds centre with its reach bits;
- the polygon left to the tile that holds its centre;
- a piece cut by an edge anchors on the edge, where the neighbour's piece anchors;
- a piece cut by two edges anchors on the corner;
- the elevation is the point value within one grid cell, and the min over the reach otherwise.

**Native porting notes.**
- Likely counterparts: `FillExtrusionBucket` (`addFeature`, worker side), `RenderFillExtrusionLayer` / the
  fill-extrusion drawable or tweaker, and the DEM data (`DEMData`).
- The anchor rule changes **what is drawn even with terrain off**, because it drops polygons per tile. Port it
  unconditionally if you want parity.
- Precompute the per-vertex anchor elevation on the render thread, keyed on (DEM tile identity, DEM revision,
  exaggeration), and upload it as a dynamic vertex attribute. Your bilinear sampling and clamping must match
  whatever Native's terrain vertex shader uses, otherwise buildings will not sit on the drawn ground.

**Commits.** `43e498a61`.

### Anchors kept on the GPU for custom layers

**Purpose.** A custom layer that draws a fill-extrusion bucket's buffers can still read each vertex's terrain
anchor, for example to tell buildings apart or to compute its own ground height.

**API / style-spec surface.** `FillExtrusionBucket.centroidVertexBuffer: VertexBuffer`. It is internal but
reachable from a custom layer through the tile's buckets. Layout: `a_centroid`, `Int16 ×2`, holding the terrain
anchor (with reach bits) described above. Custom layers can also call `terrain.getAnchorElevations(bucket,
tileID)` (marked `@internal`) for the elevation buffer.

**Behaviour.** The buffer is uploaded once in `upload()` as a dynamic buffer from `centroidVertexArray`, and
destroyed in `destroy()`. Nothing in the engine binds it.

**Implementation in GL JS.** `src/data/bucket/fill_extrusion_bucket.ts`.

**Tests.** None.

**Native porting notes.** Only needed if Native exposes buckets to custom layers, which it generally does not.
Otherwise skip it. Parchment on `dev` had a vendored custom layer (`lib/vendor/ao-shadow.mjs`) that bound
`bucket.centroidVertexBuffer` as `a_centroid` for a per-building façade hash and `anchor_elevation`. On the
`map-performance` branch that custom layer has been replaced by the engine's own shading (`Map.setShading`, see
Shading), so this commit exists for compatibility.

**Commits.** `75f89a5c9`.

### 3D depth range for custom layers

**Purpose.** Custom layers that draw 3D objects (models, landmarks) share the depth buffer with the map's extrusions, so they need the depth range the map draws its 3D layers in. Upstream used to expose it on `painter.renderContext`; since v6.19.0 the frame state is internal to `FrameRenderContext`.

**API.** `CustomRenderMethodInput.depthRangeFor3D: [number, number]`, a copy of `FrameRenderContext.depthRangeFor3D` for the frame: `[0, 1 - (layerCount + 2) * NUM_SUBLAYERS * DEPTH_EPSILON]` once the frame has been prepared. Pass it to `gl.depthRange` before drawing 3D geometry.

**Implementation.** `src/webgl/draw/draw_custom.ts` adds it to the render input; the type is in `src/style/style_layer/custom_style_layer.ts`. Test: `draw_custom.test.ts`.

**Native porting notes.** Native custom layers receive `CustomLayerRenderParameters`; add the 3D depth range there (Native's `PaintParameters::depthRangeFor3D`, likely).

## Performance

These are renderer and tile-pipeline optimisations. They add no API. Each one keeps the output the same and
removes repeated work: stencil masks redrawn for sources that share tiles, tiles re-fetched after a style edit,
every layer of a tile parsed when only one is needed, and symbol placement run at full rate while panning.

### Clipping-mask reuse across sources, redrawing only missing masks

**Purpose.** A tile's stencil clipping mask depends only on the tile's area, not on its source. Upstream
redraws every mask whenever the source changes between layers. For example, a basemap and an overlay source over
the same tiles each redraw identical masks, once per alternation. The fork keeps the masks that are still whole
in the stencil and draws only the ones that are missing.

**API / style-spec surface.** None. Internal field: `Painter._intactClippingMasks: Map<string, {tileID, ref}>`.

**Behaviour** (`Painter.renderTileClippingMasks(layer, tileIDs)`).
- Early return, as upstream, if `currentStencilSource === layer.source`, if the layer is not
  `isTileClipped()`, or if `tileIDs` is empty.
- Mask identity is `clippingMaskArea(tileID) = "${wrap}/${z}/${x}/${y}"`, from the canonical ID. Overscaled tiles
  over the same canonical area therefore share a mask.
- If `currentStencilSource === undefined`, the stencil was cleared or touched by something else, and `intact` is
  cleared. Anything else that writes the stencil must reset `currentStencilSource` to `undefined`. `clearStencil`
  does that.
- `missing` is the list of tiles whose area is not in `intact`. If any are missing **and** either the projection
  uses subdivision (globe) or any two of this layer's tiles overlap (`hasOverlappingTiles`: same wrap, and one is
  an ancestor of the other at the coarser zoom), then all tiles are redrawn (`missing = tileIDs`). This is
  because the two-pass border masks and overlapping masks depend on draw order.
- If `nextStencilID + missing.length > 256`, the stencil is cleared, `intact` is cleared, and all tiles are
  redrawn.
- `_tileClippingMaskIDs` maps every tile's key to its ref: the intact ref where one exists, otherwise a fresh
  `nextStencilID++`. For each newly drawn tile, any intact entry whose tile overlaps it is evicted, because it has
  been overwritten. The new `{tileID, ref}` is then recorded.
- Masks are drawn only for `missing`: the border pass first under subdivision, then the borderless final pass.
  Colour and depth writes are disabled only when something is drawn.

**Implementation in GL JS.** `src/render/painter.ts`: `renderTileClippingMasks`, plus the helpers
`clippingMaskArea`, `tilesOverlap` and `hasOverlappingTiles`. The first version (`f3cddca7d`) reused the stencil
only when the ordered tile-key list was identical across sources. `5d70660cc` replaced that with the per-area
scheme above.

**Tests.** `src/render/painter.test.ts`:
- masks are reused for an overscaled tile over the same area;
- masks are drawn only for the tiles the stencil lacks;
- masks are redrawn once a tile over the same area has overwritten them;
- all masks are redrawn when the tiles overlap each other, or after the stencil is cleared.

**Native porting notes.** The likely counterpart is `PaintParameters::renderTileClippingMasks` and its
`tileClippingMaskIDs` map. On the drawables renderer, the equivalent is the stencil-mask generation in
`RenderOrchestrator` / `TileLayerGroup` (look for `clipping mask` / `stencilModeFor3D`). The 8-bit stencil limit
of 256 refs is the same. Keep the "all redraw" fallback for globe/subdivision and for overlapping tiles.

**Commits.** `f3cddca7d`, `5d70660cc`.

### Tile cache kept through a layer change

**Purpose.** A style-layer edit (`setFilter`, `setLayoutProperty`, adding or removing a layer) leaves the source
data unchanged. Upstream nonetheless calls `TileManager.reload()`, which **empties the out-of-view tile cache**,
so panning back afterwards re-fetches tiles. The fork keeps the cache and lays cached tiles out again lazily, when
they come back into view.

**API / style-spec surface.** Internal: `TileManager.relayout()`, `_layoutGeneration: number`,
`_cachedLayout: WeakMap<Tile, number>`.

**Behaviour.**
- `Style._reloadSource(id)`, the path a layer change takes, now calls `tileManager.relayout()` instead of
  `reload()`. Genuine data changes still use `reload()`. That path still resets the cache.
- `relayout()`:
  - if the manager is paused, it sets `_shouldReloadOnResume` and returns;
  - otherwise it increments `_layoutGeneration` and calls `_reloadInView()`, the loop over in-view tiles that
    `reload` also uses after its cache reset, minus the reset. In-view tiles are reloaded (laid out again on the
    worker) at once.
- When a tile leaves view (`_removeTile` with `uses === 0`), it now goes to the cache if `hasData()`, **including
  while it is `'reloading'`**. The manager stamps the tile with the current generation
  (`_cachedLayout.set(tile, _layoutGeneration)`). A tile with no data is aborted, as before.
- When the cache evicts a tile that is still `'reloading'`, the manager sets `tile.aborted = true`, calls
  `_abortTile`, then unloads the tile.
- `_addTile`: a tile taken from the cache whose stamp is not the current generation is "stale". It is re-added
  and shown with its previous layout, and `_reloadTile(key, 'reloading')` is then called to lay it out again.
- In the source-data event handler, while paused, a `content` change now sets `_shouldReloadOnResume = true`.
  Upstream returned early. This means `resume()` does a full reload, cache included.

**Implementation in GL JS.** `src/tile/tile_manager.ts`: `relayout`, `_reloadInView` (split out of `reload`),
the `TileCache` eviction callback, `_addTile`, `_removeTile`, and the data-event handler. `src/style/style.ts`:
`_reloadSource`.

**Tests.**
- `src/tile/tile_manager.test.ts`:
  - cached tiles are kept, and one is laid out again when it returns;
  - a cached tile comes back as it is when nothing changed since it was cached;
  - a tile that leaves the view mid-reload is kept, and its reload is aborted if the cache drops it;
  - a full reload still drops the cache.
- `src/style/style.test.ts`: expectations switched from `reload` to `relayout`.

**Native porting notes.** The likely counterparts are `TilePyramid::update` (its `needsRelayout` handling), the
`TileCache`, and `Tile::setLayers`. In Native, layer changes flow as `needsRelayout` into
`RenderSource::update`. Check whether that path clears the cache. If it does, add a layout generation per
pyramid: stamp tiles when they are cached, and on retrieval call `setLayers` (relayout) for stale ones while
still rendering their old buckets. Keep tiles that are mid-relayout in the cache, and cancel their work on
eviction.

**Commits.** `a91513a81`.

### Parse a tile's layers as they are read (main thread)

**Purpose.** On the main thread, `FeatureIndex` (queries) and feature-state updates re-read the raw vector tile.
Upstream parses every layer, decoding all of its keys and values, even when only one layer is needed. The fork
parses each layer on first access.

**API / style-spec surface.** None. New module `src/source/lazy_vector_tile.ts`, exporting
`lazyVectorTileLayers(data): {[name]: VectorTileLayerLike}`.

**Behaviour.**
- The function makes one scan of the PBF:
  - for each field with tag `3` (layer) and wire type `2` (length-delimited), it reads the layer's `name` (tag
    `1`) without moving past the message, then skips to the message's end;
  - other fields, and layers with no name, are skipped.
- Each name becomes an enumerable, configurable getter. On first access it builds
  `new VectorTileLayer(new PbfReader(data) at start, end)` and memoises it.
- A missing name returns `undefined`.
- `Object.keys(layers)` lists every layer without parsing any of them.
- `FeatureIndex.loadVTLayers` uses it for MVT. MLT and GeoJSON are unchanged.
- `Tile.setFeatureState` now checks for states before touching `vtLayers[sourceLayerId]`, so layers that carry
  no state are never parsed. It skips when `!states || Object.keys(states).length === 0`, which replaces
  upstream's `.length === 0` check on an object.

**Implementation in GL JS.** `src/source/lazy_vector_tile.ts`, `src/data/feature_index.ts`, `src/tile/tile.ts`.

**Tests.** `src/source/lazy_vector_tile.test.ts`:
- the lazy result holds the same layers and features as a whole parse (properties, ids, geometry);
- a layer is parsed once, and only when read.

**Native porting notes.** Native's `VectorTileData` (over `mapbox::vector_tile::buffer`) already indexes layers
by name and parses a layer lazily via `getLayer`, which is likely. Verify that feature-state and query paths do
not force-parse every layer. If they do not, nothing needs porting.

**Commits.** `6278321dc` (the parsing part).

### Labels placed half as often while panning

**Purpose.** While the camera pans or rotates without zooming, labels ride the map they were placed on, so
placing them less often is not visible. The fork doubles the placement interval in that state, which halves the
cost of placement.

**API / style-spec surface.** None. The constant is `MOVING_PLACEMENT_STRETCH = 2` in `src/style/style.ts`.

**Behaviour.**
- In `Style._updatePlacement`: `stretch = map.isMoving() && !map.isZooming() ? 2 : 1`.
- `placementSettled = pauseablePlacement.isDone() && !placement.stillRecent(now, zoom, stretch)`.
- `Placement.stillRecent(now, zoom, stretch = 1)` returns `commitTime + fadeDuration * durationAdjustment *
  stretch > now`. The `durationAdjustment` term (the upstream `1 - zoomAdjustment(zoom)` once zoom has settled)
  is unchanged.
- A new placement therefore starts at most once every `2 × fadeDuration` while panning or rotating, and once every
  `fadeDuration` otherwise.
- `forceFullPlacement` and a missing placement still bypass the check.
- Pitch-only changes count as moving and not zooming, so they are stretched too.

**Implementation in GL JS.** `src/style/style.ts` and `src/symbol/placement.ts`. This arrives in the same commit
as engine shading, but it is independent of it.

**Tests.** None specific.

**Native porting notes.** The likely counterparts are `PlacementController::placementIsRecent` / `Placement`'s
commit time, together with the `TransformState` / `UpdateParameters` camera-moving flags in
`RenderOrchestrator::createRenderTree`. Native's `mode == MapMode::Continuous` path already gates placement on
recency. Multiply the window by 2 when the transform is moving and not zooming.

**Commits.** `f6bb4474e` (the `style.ts` / `placement.ts` part only).

## Hiding without reload

In upstream, three of the usual ways to hide features make tiles reload or get re-parsed. Setting `visibility: none` stops the source loading and drops its buckets. A `filter` or `within` change lays every tile of the source out again. Zeroing a data-driven opacity re-parses the tiles. The fork adds three hiding mechanisms that leave tiles and buckets alone. A layer can be muted, so it is skipped at draw time. Symbols can be left unplaced inside a geographic area. A fill-extrusion with a negative height is thrown out in the vertex shader, which lets a feature state hide individual buildings. All three ship in one commit and share no code.

### Muted layers

**Purpose.** This stops a layer being drawn while its source keeps loading and its buckets keep being built. Turning it on or off costs nothing but a repaint. Its features stay readable through `querySourceFeatures`.

**API / style-spec surface.**
- `Map#setLayerMuted(layerId: string, muted: boolean): this`. It calls `style.setLayerMuted` and then `triggerRepaint()`.
- `Style#setLayerMuted(layerId: string, muted: boolean): void`. It calls `_checkLoaded()` first. For an unknown id it fires an `ErrorEvent` with the message `Cannot mute non-existing layer "<id>".` and returns.
- `StyleLayer#muted: boolean`, default `false`. This is a plain runtime field, not a style-spec property:
  - it is not serialised by `getStyle()` / `serialize()`
  - it is not diffed by `setStyle`
  - there is no getter on `Map`
  - no event is fired
  - a layer that is removed and added again comes back unmuted.

**Behaviour.**
- A muted layer is skipped in the offscreen pass (`Painter.render`, the loop over `hasOffscreenPass()` layers such as heatmap, hillshade, color-relief and custom `prerender`). It is also skipped in every main pass through `Painter.renderLayer`, using the same early return as `isHidden(zoom)`.
- With terrain on, `RenderToTexture` leaves a muted layer out of `_renderableLayerIds`. That list decides which layers are draped and makes up the fingerprint that decides whether a tile's texture has to be redrawn. Muting a draped layer therefore re-renders the drape textures. `RenderToTexture.renderLayer` returns `false` for a muted layer, so it is drawn neither into the texture nor in the 3D pass.
- The fork's shading pass (see Shading) skips muted `fill-extrusion` layers when it collects shadow casters (`shading.ts`, `layer.muted || layer.isHidden(zoom)`). A muted building layer therefore casts no shadow.
- **Not affected:**
  - Tile loading and worker layout: `worker_tile.ts` checks only `isHidden`.
  - Feature queries.
  - **Symbol placement.** `PauseablePlacement` does not check `muted`, so a muted symbol layer is still placed and its collision boxes still block other labels. It is just invisible. To free that space as well, use the symbol clip below, or `visibility`.

**Implementation in GL JS.**
- `src/style/style_layer.ts`: the `muted` field.
- `src/style/style.ts`: `setLayerMuted`.
- `src/ui/map.ts`: the public method.
- `src/render/painter.ts`: the offscreen-pass loop and `renderLayer`.
- `src/webgl/render_to_texture.ts`: `prepareForRender` (the renderable-id filter) and `renderLayer`.
- Everything runs on the main thread. The worker never sees the flag.

**Tests.** No dedicated unit or render test for muting in this commit.

**Native porting notes.**
- The likely counterpart is a runtime flag on `style::Layer` / `Layer::Impl` (not in `LayerProperties`, so it is not serialised). Check it where a `RenderLayer` decides whether it has anything to render: `RenderLayer::hasRenderPass` / `needsRendering`, or the place where `RenderOrchestrator` builds the per-frame layer list.
- Do **not** route it through `visibility`. In Native, `visibility: none` also stops the source's tiles from being required, which is exactly what this feature avoids.
- If terrain draping is ported, make sure the drape cache key includes the muted state.
- Keep the placement behaviour the same: muted symbols still collide.

**Commits.** `d8ea3c430`

### Symbol clip at placement

**Purpose.** For a set of symbol layers, this leaves unplaced every symbol that lies wholly inside an area. The test is the same one a `within` filter applies: the line a symbol is placed along, or its anchor point if it has no line. Changing the area triggers only a new placement, never a tile reload. In Parchment it hides road names and arrows on flat bridge lines that a 3D bridge deck now covers.

**API / style-spec surface.**
- `Map#setSymbolClip(layerIds: string[], area: GeoJSON.Polygon | GeoJSON.MultiPolygon | null): this`. It forwards to the style and then calls `triggerRepaint()`.
- `Style#setSymbolClip(...)`. It calls `_checkLoaded()`, builds `_symbolClip = area ? createSymbolClip(layerIds, area) : null`, then calls `this.placement?.setStale()`.
- Only one clip is active at a time: each call replaces the last, and `null` clears it.
- Coordinates are longitude/latitude. There is no event and no style-spec property, and the clip is not serialised.
- Exported helpers: `createSymbolClip(layerIds, area): SymbolClip` and `symbolClipTester(clip, bucketLayerIds, canonicalTileID)`.
- Type: `SymbolClip = {layerIds: ReadonlySet<string>, polygons: ClipPolygon[]}`.
- Type: `ClipPolygon = {minX, minY, maxX, maxY, rings: number[][]}`. Each ring is a flat array of x, y pairs in **mercator units 0..1**, converted with `mercatorXfromLng` / `mercatorYfromLat`. The bbox is the union over all of the polygon's rings. Empty polygons are dropped.

**Behaviour.**

1. **Hand-off.** When `Style._updatePlacement` creates a new `PauseablePlacement`, it copies `_symbolClip` into `placement.symbolClip`. The clip applies from the next full placement. `setStale()` makes sure that placement happens even when the camera is still.

2. **Choosing a tester for each bucket** (`placeLayerBucketPart`). `symbolClipTester(clip, bucket.layerIds, tileID.canonical)` returns either `null`, meaning no per-symbol cost, or a test function:
   - It returns `null` if none of the bucket's layer ids is in `clip.layerIds`. The check runs on **bucket** layer ids, so in a bucket shared by layers with identical layout, naming any one of those layers clips them all.
   - Otherwise it works out the tile's square in mercator: `size = 1/2^z`, `x0 = x*size`, `y0 = y*size`.
   - It keeps the polygons whose bbox overlaps that square, and returns `null` if none do.
   - The test converts each tile-unit point to mercator with `x0 + v * size/EXTENT` (and `y0` for y). The symbol counts as clipped when **any** nearby polygon "holds" the points.

3. **The points tested for each symbol** (`Placement._isClipped`):
   - Take the first placed text symbol index that is `>= 0`, in this order: center, left, right, vertical justified. Failing that, take `placedIconSymbolIndex`.
   - If there is no placed symbol, or its `lineLength < 2` (a point placement), test the anchor alone: `[anchorX, anchorY]`.
   - Otherwise test every vertex of the symbol's line, from `bucket.lineVertexArray[lineStartIndex .. lineStartIndex + lineLength)`. This is the whole line feature the label is placed along, not just the stretch under the glyphs.

4. **What "holds" means** (`holds`). This is the rule of the `within` expression:
   - **Every point is inside the polygon.** `contains` is an even-odd ray-casting test across all rings, so holes count. It starts with a quick bbox reject. A point exactly on an edge follows the usual half-open rule `(yi > y) !== (yj > y)`.
   - **No segment of the line properly crosses any ring edge.** `crosses` needs strict two-sided orientation tests both ways, so touching or collinear contact does not count as crossing.
   - In effect, a line whose two ends sit inside the outer ring but which passes over a hole is not held.
   - A line spanning two polygons of a MultiPolygon is not held either, even if they share an edge. The whole line must lie in one polygon.

5. **Result.**
   - A clipped symbol gets `placements[crossTileID] = new JointPlacement(false, false, false)` (text off, icon off, skipFade off).
   - Placement returns before collision testing, so the symbol takes **no** collision space.
   - It fades out like any symbol that fails placement.
   - The check runs after the `seenCrossTileIDs` duplicate check and before the symbol-anchor-offset shift and the `holdingForFade` handling.

6. **Terrain and globe.** The test runs in 2D tile and mercator space on the symbol's geometry, so it ignores elevation and projection. On globe it uses the same mercator maths, because tile coordinates are mercator.

**Implementation in GL JS.**
- `src/symbol/symbol_clip.ts` (new): `createSymbolClip`, `contains`, `twoSided`, `crosses`, `holds`, `symbolClipTester`.
- `src/symbol/placement.ts`: the `symbolClip` field, `_isClipped`, and the early-out in `placeSymbol`.
- `src/style/style.ts`: the `_symbolClip` field, `setSymbolClip`, and the copy into new placements.
- `src/ui/map.ts`: the public method.
- Everything runs on the main thread, where placement happens.

**Tests.** `src/symbol/symbol_clip.test.ts` covers:
- a point inside and outside the area
- a point in a hole
- a line wholly inside
- a line with one end outside
- a line across a hole
- a line spanning two halves of a MultiPolygon
- `null` for a layer that is not named and for a tile the clip does not reach.

**Native porting notes.**
- Likely counterparts:
  - `mbgl::Placement::placeBucket` / `placeSymbol` in `src/mbgl/text/placement.cpp`, for the early `JointPlacement{false, false, false}`.
  - `PlacedSymbol::lineStartIndex` / `lineLength` and `SymbolBucket::lineVertices`, for the line points.
  - The `within` expression's geometry helpers in `src/mbgl/style/expression/within.cpp`, which can stand in for `contains` and `crosses`.
- Native's `within` works on tile-integer coordinates scaled to a world size. Either reuse it or keep this file's mercator-double maths, but keep the "one polygon holds the whole line" rule.
- Expose it on `Map` (or on `Style`) and force a placement on change. The likely place is `RenderOrchestrator` / `Placement` invalidation, the equivalent of `placement.setStale()`.

**Commits.** `d8ea3c430`

### Extrusions dropped by a negative height

**Purpose.** This hides individual fill-extrusion features through feature state, with no filter change and so no tile re-layout. Any feature whose evaluated `fill-extrusion-height` is below zero is not drawn.

**API / style-spec surface.**
- No new property. The meaning of an existing value changes: `fill-extrusion-height < 0` now means "not drawn".
- Upstream, a negative height simply produces geometry below the base.
- Typical use: `['case', ['boolean', ['feature-state', 'inside'], false], -1, <height>]`.

**Behaviour.**
- In `fill_extrusion.vertex.glsl` and `fill_extrusion_pattern.vertex.glsl`, right after the `#pragma ... initialize` block:

  ```glsl
  if (height < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  ```

  Every vertex of the feature is pushed outside clip space, so its triangles are culled and nothing reaches the fragment shader.
- The check reads the interpolated, evaluated `height` paint value (zoom-interpolated, feature-state aware). A height of exactly `0` is still drawn.
- The test runs per vertex. A height that varies within one feature only matters through the feature's single evaluated value, so in practice the whole feature is dropped.
- The shadow and light-map depth shader the fork adds later (`fill_extrusion_depth.vertex.glsl`, see Shading) applies the same `height < 0.0` early-out. A hidden building therefore casts no shadow and gives off no lamplight.
- The fork's building ground-elevation buffer and the anchor changes are unaffected.

**Implementation in GL JS.** Shader-only: two vertex shaders. No bucket or draw-call change. Feature-state updates already re-upload the paint-attribute buffers.

**Tests.** None in this commit.

**Native porting notes.**
- Add the same early-out to Native's fill-extrusion and fill-extrusion-pattern vertex shaders: `shaders/fill_extrusion.vertex.glsl` and `fill_extrusion_pattern`, plus the generated `programs/` sources for GL, and the Metal/Vulkan equivalents under `shaders/` in newer Native.
- Native evaluates feature state into the paint buffers the same way, so no other change is needed.
- On Metal, write the clip-space position as a `float4` outside the [-w, w] range.

**Commits.** `d8ea3c430`

### How Parchment uses these

- **Muted layers.** `setLayerMuted` hides the flat bridge layers while a 3D deck layer stands in for them (`services/map/providers/maplibre.strategy.ts`). The flat layers' source keeps loading, so the deck layer can still read the bridges with `querySourceFeatures`.
- **Symbol clip.** `setSymbolClip` is called on the flat bridge-label layers with the deck footprints as a MultiPolygon, or with `null` when the decks are not covering them. This keeps road names and arrows off ground that a deck now hides.
- **Negative extrusion height.** Buildings replaced by a landmark model, or shown inside by a floor plan, get `fill-extrusion-height: -1` through `['feature-state', 'replaced' | 'inside']` (`lib/map-objects/landmarks.ts`). The same commit pattern uses `fill-opacity: 0` and `line-width: 0` for the flat layer types.

## Shading

The fork shades extrusions inside the engine. That covers three things: a sun shadow map, a ground ambient occlusion and a lamplight map. All three are drawn from fill-extrusion layers that opt in, and from app-registered "casters" (custom-layer models). The ground, terrain, the extrusions themselves and the casters all read them. Each map covers a square of ground that holds still while the camera moves, so a camera-only frame redraws none of them. Shading is off until the app calls `Map.setShading(options)`. It is configured through a live object whose fields are read every frame, not through the style.

All code lives in `src/render/shading/shading.ts` (class `Shading`) and `src/render/shading/sun_light.ts` (pure geometry), with programs in `src/webgl/program/shading_program.ts`. Likely Native home: a new `mbgl::Shading` object owned by the `RenderOrchestrator` / `PaintParameters`, with its offscreen passes run before the main pass, the way `RenderOrchestrator` renders hillshade prepare and other offscreen work.

### Sun shadows and ground occlusion

**Purpose.** Buildings in layers marked `fill-extrusion-cast-shadows` cast directional sun shadows onto each other, onto flat ground or terrain, and onto custom-layer models. A soft dark "contact" occlusion sits on the ground around each footprint. The walls get a darkened foot, an optional roofline edge, sun/sky tints and an optional app-supplied procedural facade shader.

**API / style-spec surface.**

Style spec (`src/style-spec/fork_extensions.ts`, added to `paint_fill-extrusion`):

| Property | Type | Default | Expression | Transition | Property type | Notes |
|---|---|---|---|---|---|---|
| `fill-extrusion-cast-shadows` | boolean | `false` | `zoom` only, not interpolated | no | data-constant | Opts the layer into shading: it casts and is shaded. Does nothing until `setShading` is on. |
| `fill-extrusion-roof-color` | color | `rgba(0, 0, 0, 0)` | `zoom`, `feature`, `feature-state`, interpolated | yes | data-driven | Top-face colour under shading. Alpha 0 means the walls' colour. `requires: fill-extrusion-cast-shadows`. |
| `fill-extrusion-facade-style` | number | `0` | `zoom`, `feature`, `feature-state`, not interpolated | no | data-driven | Passed to the wall shader as `style`. |
| `fill-extrusion-facade-seed` | number | `0` | same | no | data-driven | Integer 0–65535, hashed to a 0–1 `seed` for the wall shader. Should come from a feature property so it is stable across zooms. |

These become shader paint attributes through the normal `#pragma maplibre: define/initialize` machinery (`roof_color`, `facade_style`, `facade_seed`). They are only declared inside `#ifdef SHADING`.

Map methods (`src/ui/map.ts`):

- `setShading(options: ShadingOptions | null): Shading | null`. Destroys any existing `Shading`, creates `new Shading(painter, options)` (or sets it to `null`), triggers a repaint and returns the live object.
- `getShading(): Shading | null`.
- On WebGL context re-creation (`_setupPainter`), the existing `Shading` object is moved onto the new `Painter`. Its GL objects belonged to the old context and are made again lazily.

Exported types (`src/index.ts`): `Shading`, `ShadingOptions`, `ShadingCaster`, `SunFrame`, `OcclusionFrame`, `GroundOcclusion` (f9e301cdc), `GroundLights` (9f4378d49), `WallShader`.

`ShadingOptions` is `Partial<Pick<Shading, …>>` of these fields. All are public fields on `Shading` and can be changed between frames; set a field, then repaint.

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. |
| `minZoom` / `maxZoom` | `14` / `20` | Shading is inactive below `minZoom`. The occlusion radius interpolates between them. |
| `strength` | `0.5` | How dark a wall's foot is. |
| `band` | `1` | Share of the wall height the foot darkening reaches up (clamped to ≥ 0.01). |
| `edge` / `edgeWidth` | `0` / `1.5` | Roofline edge darkness and width in device px. |
| `wallShader` | `null` | `WallShader`, see below. |
| `sunShadows` | `true` | Draw the sun shadow map. |
| `groundOcclusion` | `true` | Draw the ground occlusion. |
| `visibility` | `1` | Number, or `(pitch) => number`. How much of the shadows/occlusion show (multiplies sun strength and occlusion). ≤ 0 skips both maps. |
| `opacity` | `1` | Multiplies all ground effects (thin them with extrusion opacity). |
| `sunCeiling` | `400` | Tallest caster in metres. Sets the light-view depth range. |
| `heightScale` | `0.38` | Shadow length as a multiple of caster height. |
| `shadowAlpha` | `0.35` | Darkness of a shadow on the ground. ≤ 0.001 skips the sun map. |
| `shadowOffset` | `[-0.5, 0.5]` | Ground-plane direction a shadow falls (+x east, +y north). |
| `shadowColor` | `[0,0,0]` | Ground shadow tint. |
| `sunTint` / `skyTint` | `[1,1,1]` | Wall tint facing / away from the light. |
| `wallRise` / `roofLift` | `0` / `0` | Wall lighter at top than foot; roof lighter than walls. |
| `casters` | `new Set()` | `Set<ShadingCaster>`. |
| `fadeZoom` | `1.2` | Zoom levels past `minZoom` over which ground effects ramp in. |
| `topDownOpacity` / `topDownPitch` | `0.5` / `25` | Occlusion multiplier looking straight down, ramping to 1 by `topDownPitch` degrees. |
| `aoRadiusMin` / `aoRadiusMax` | `30` / `120` | Occlusion radius in device px at `minZoom` / `maxZoom`. |
| `aoIntensity` | `0.8` | Occlusion strength. ≤ 0 skips the occlusion map. |
| `shadowMapSize` | `2048` | Sun depth map texels per side. |
| `lightIntensity` | `0` | Lamplight strength (see Lamplight). |
| `spillColor` | `[1, 0.8, 0.55]` | Lamplight spill colour. |
| `lightBlur` | `3` | Lamplight blur in metres. |
| `lightHeight` | `6` | Metres up a wall over which lamplight fades. |

Read-only state: `frame: SunFrame | null`, `active: boolean`, `groundLayer: string | null`, and `drawn: {sun, occlusion, lights}` (counters of actual redraws, used by tests).

```ts
type SunFrame = {
  light: Mat4;          // clip ← mercator (x,y in 0..1 world units, z in mercator units = metres * perMetre)
  perMetre: number;     // mercator units per metre at the region's centre
  texture: WebGLTexture;// DEPTH_COMPONENT24 compare texture
  size: number;         // texels per side
  depthPerMetre: number;// light-clip depth (0..1 range) per metre
  texelMetres: number;  // metres one texel spans across the light (longer side)
  strength: number;     // 0..1, the visibility fade
};
type OcclusionFrame = {matrix: Mat4};       // clip ← mercator, straight overhead
type GroundOcclusion = {uv: Mat4; texture: WebGLTexture; strength: number; power: number};
  // a ground-lying surface darkens by strength * pow(clamp(2 * texel.r, 0, 1), power) at uv ← mercator
type ShadingCaster = {
  shadowVersion?: number;   // change it when what it casts changes; undefined → NaN in the key → redraw every frame
  drawSunDepth?(gl, frame: SunFrame): void;
  drawOcclusion?(gl, frame: OcclusionFrame): void;  // draw footprint in any colour
  receiveSun?(frame: SunFrame): void;
  receiveOcclusion?(occlusion: GroundOcclusion): void;   // f9e301cdc
  drawLights?(gl, frame: OcclusionFrame): void;          // 9f4378d49
  receiveLights?(lights: GroundLights): void;            // 9f4378d49
};
type WallShader = {source: string; uniforms?: {[name: string]: number | number[]}; light?: boolean};
```

`Mat4` is a column-major `Float64Array(16)`. A `WallShader.source` must define `vec3 shade_wall(vec3 color, vec3 wall, float seed, float style)`. `wall` is (metres along the wall, metres up it, roof height). `seed` is the 0–1 hash of `facade-seed`, and `style` is `facade-style`. With `light: true` it must also define `float wall_light(float seed, float style, float height)` (see Lamplight). `uniforms` are set by name with `uniform1f/2fv/3fv/4fv`, chosen by value length; locations are cached per program.

**Behaviour.**

*Per-frame `prepare()`*, called from `Painter.render` after `maybeDrawDepth()` and before `renderToTexture.prepareForRender` and the offscreen pass:
1. Reset `frame`, `occlusion`, `lights`, `groundLayer`. Set `active = enabled && zoom >= minZoom`. If inactive, stop.
2. Cast layers are the style-ordered fill-extrusion layers that are not muted, not hidden at this zoom, and have `fill-extrusion-cast-shadows`. `groundLayer` is the first of them (bottom-most).
3. `fade` = `visibility` (or `visibility(pitch)`). If ≤ 0, stop.
4. Tiles: for each cast layer whose `fill-extrusion-opacity` ≠ 0, every visible coordinate of its source with a bucket that has a `layoutVertexBuffer`. If there are no tiles and no casters, stop.
5. Run, in this order: `updateOcclusion` (if `groundOcclusion && aoIntensity > 0`), `updateSun` (if `sunShadows && shadowAlpha > 0.001`), then `updateLights` (if `lightIntensity > 0`). If any of them drew, mark context state dirty and rebind the default framebuffer and viewport.
6. Hand frames to casters: `receiveSun(frame)`, `receiveOcclusion({uv, texture: blurred, strength, power})`, `receiveLights(...)`.

*Caching key.* Each map keeps a key array. If it is equal element by element to last frame's, the map is not redrawn. The common part (`castKey`) holds, per cast tile: a stable object id of the bucket, `coord.key`, `bucket.paintRevision` (a new counter, incremented in `FillExtrusionBucket.update` when feature state repaints), `bucket.anchorElevationKey` (from the building ground-elevation feature), and the zoom term. The zoom term is `clamp01(zoom - coord.overscaledZ)` only if `fill-extrusion-height` or `-base` is zoom-dependent in its binder; otherwise 0. Then each caster's `shadowVersion` follows, or `NaN`, which never compares equal and so forces a redraw every frame.
- Sun key: `[shadowMapSize, ...light matrix]` + castKey.
- Occlusion key: `[region.x, region.y, region.half, sigma]` + castKey.
- Lights key: `[region.x, region.y, region.half, sigma, wallShader id if wallShader.light else 0]` + castKey.

*Steady region* (`steadyRegion(x, y, half)` in mercator):
`size = 2^(ceil(log2(half) * 2) / 2)` (rounded up to a half power of two), `cell = size / 4`. The centre is snapped to `round(x / cell) * cell` (same for y), and `half_out = size + cell / 2`. The region therefore moves only when the centre crosses a quarter-cell grid, or the covered size passes a √2 step.

*Sun view* (`sunView`):
- `perMetre = 1 / (40075016.686 * cos(lat))` at the centre, where `lat = atan(sinh(π(1 − 2y)))`.
- `reach = 2500 m * 2^(16 − zoom) * perMetre` (`SUN_REACH = 2500`).
- Unproject the four screen corners to mercator and clamp each corner's offset from the centre to length `reach`. The region is `steadyRegion` of the bounding box centre, with half = max(box w, box h) / 2.
- `floor = round(terrainElevationAtCenter / 25) * 25` m (0 with no terrain).
- Light direction `toward = [shadowOffset.x * heightScale, shadowOffset.y * heightScale, -1]` (east, north, up).

*Sun light matrix* (`sunLightMatrix`): an orthographic box looking down the light.
- `f = normalize(toward)`, `r = normalize(|f.z| > 0.999 ? [1,0,0] : cross(f, [0,0,1]))`, `u = cross(r, f)`.
- `reach_m = region.half / perMetre`. `covered = min(ceiling, max(2 * reach_m, 30))` (`MIN_COVERED_HEIGHT = 30`).
- Bound the corners `e, n ∈ {±reach_m}` at heights `h ∈ {floor − 0.25·ceiling, floor + covered, floor + ceiling}`, projected onto (r, u, f). Points above `floor + covered` extend only the depth (f) bounds, not x/y. The covered height limits the texel spend across the light, while taller casters still fit in depth.
- Extend `lo.z -= ceiling` so casters just outside the region still shadow into it.
- Scale/offset each axis to [−1, 1]. Compose with metric ← mercator: `east = (x − cx)/pm`, `north = −(y − cy)/pm`, `up = z/pm`.
- Outputs `depthPerMetre = 1 / (hi.z − lo.z)` and `texelMetres = max(hi.x − lo.x, hi.y − lo.y) / size`.

*Sun depth pass* (`updateSun`), only when the key changed:
- FBO with a `DEPTH_COMPONENT24` texture via `texStorage2D`. Filtering LINEAR/LINEAR, CLAMP_TO_EDGE, `TEXTURE_COMPARE_MODE = COMPARE_REF_TO_TEXTURE`, `COMPARE_FUNC = LEQUAL`. Recreated when `shadowMapSize` changes.
- Clear depth to 1. Enable `POLYGON_OFFSET_FILL` with `polygonOffset(1.5, 2)`. Depth `LESS`, read-write, range [0, 1]. No colour writes; stencil and cull off.
- Draw each cast tile with program `fillExtrusionDepth`, `u_projection_matrix = light × tileToMercator(z, x, y, wrap, perMetre)`. `tileToMercator` maps tile units (8192 per side, z in metres) to mercator: scale `1/(8192·2^z)` for x and y, `perMetre` for z, translate `((x + wrap·2^z)/2^z, y/2^z)`. Terrain anchor elevations are passed when terrain is on.
- Reset depth/stencil/colour/cull state as above, then call `caster.drawSunDepth(gl, frame)`. Turn the polygon offset off.

*Ground occlusion pass* (`updateOcclusion`), only when the key changed:
- Region (`overhead()`): zoom is held per half zoom, `zoomH = floor(zoom * 2) / 2`. `region = steadyRegion(centre, 700 m * 2^(16 − zoomH) * perMetre)` (`OCCLUSION_REACH = 700`). `overhead = overheadMatrix(region)` is scale `1/half`, translate `−centre/half`, z dropped. `uv = CLIP_TO_UV × overhead`, where `CLIP_TO_UV` is `0.5·x + 0.5` per axis.
- Radius in metres (`occlusionRadius(zoom, y)`): `t = clamp01((zoom − minZoom)/(maxZoom − minZoom))`. `px = min(aoRadiusMin + t·(aoRadiusMax − aoRadiusMin), 0.2 · max(width, height) · pixelRatio)`. `radius = px / (tileSize · 2^zoom · perMetre · pixelRatio)`. It is evaluated at `zoomH` when baking.
- `sigma` (in texels of the 1024 map) = `radius / 2.1 · perMetre / (2·half) · 1024` (`RADIUS_IN_SIGMAS = 2.1`).
- Coverage target: RGBA8 1024² with a full mip chain (`LINEAR_MIPMAP_NEAREST` min filter). Clear to transparent. Draw the cast tiles with `fillExtrusionDepth` (no depth, unblended colour; fragment writes `vec4(1)`), `u_projection_matrix = overhead × tileToMercator(…, perMetre = 0)`. Then `caster.drawOcclusion(gl, {matrix: overhead})`. Then `generateMipmap`.
- Blur (`blur`): `level = clamp(floor(log2(sigma / 2)), 0, 4)`, `size = 1024 >> level`. Two RGBA8 targets of that size, without mips. Horizontal pass reading mip `level` of the source, `u_step = (1.5/size, 0)`. Vertical pass reading target 1 at lod 0, `u_step = (0, 1.5/size)`. `u_blur = (max(sigma / 2^level / 1.5, 0.1), lod)`. The result is in `blurred[0]`.
- Read-time narrowing: the map was baked at the widest radius of its half zoom. `power = max((radius_baked / radius_now)^2, 1)`. `strength = aoIntensity · groundOpacity · opacity · fade · pitchFade`. (`opacity` was added to this product in f9e301cdc.)
- `groundOpacity = smoothstep01(clamp01((zoom − minZoom) / max(fadeZoom, 0.001)))`, with `smooth(t) = t²(3 − 2t)`.
- `pitchFade = topDownOpacity + (1 − topDownOpacity) · smooth(clamp01(pitch / max(topDownPitch, 0.001)))`.

*Receivers' uniforms* (`receive()`), also binding textures. Sun depth goes on unit 5 (`SUN_SHADOW_UNIT`), occlusion on unit 6 (`OCCLUSION_UNIT`) and lights on unit 7 (`LIGHTS_UNIT`). A missing map is replaced by a 1×1 depth texture on unit 5, or a 1×1 transparent RGBA texture on units 6 and 7, so a shadow sampler never sits on a colour texture and vice versa. Unit 0 is re-activated afterwards.
- `u_sun = (frame.strength or 0, 1/size, depthPerMetre)`
- `u_occlusion_strength = (strength, power)`
- `u_ground = (heightScale · |shadowOffset|, shadowAlpha · groundOpacity · opacity)`, i.e. the ground's slope to the light and the shadow darkness.
- `u_shadow_color`, plus `u_lights` / `u_light` (Lamplight).

*Fragment prelude* (`_prelude.fragment.glsl`, inside `#ifdef SHADING`):
```glsl
float sun_shade(highp vec4 p, highp float slope) {   // 0 lit .. 1 shadowed
  if (u_sun.x <= 0.0) return 0.0;
  vec3 c = p.xyz / p.w * 0.5 + 0.5;
  float reach = max(abs(c.x*2-1), abs(c.y*2-1));
  if (reach >= 1.0 || c.z > 1.0) return 0.0;
  float z = c.z - (0.4 + 1.2 * min(slope, 4.0)) * u_sun.z;   // slope-scaled bias, in metres → depth
  float d = 0.75 * u_sun.y;                                   // 4 PCF taps at ±0.75 texel
  float lit = sum of textureLod(u_sun_shadow, vec3(c.xy ± d, z), 0.0) over 4 taps;
  return u_sun.x * (1.0 - lit * 0.25) * (1.0 - smoothstep(0.9, 1.0, reach));
}
float ground_occlusion(vec2 uv) {
  if (u_occlusion_strength.x <= 0.0) return 0.0;
  reach as above; if (reach >= 1.0) return 0.0;
  float near = clamp(2.0 * textureLod(u_occlusion, uv, 0.0).r, 0.0, 1.0);
  return u_occlusion_strength.x * pow(near, u_occlusion_strength.y) * (1.0 - smoothstep(0.8, 1.0, reach));
}
vec4 ground_shade(vec4 sun, vec2 occlusion_uv) {   // premultiplied
  float shadow = sun_shade(sun, u_ground.x) * u_ground.y;
  float occlusion = ground_occlusion(occlusion_uv);
  vec4 light = lamp_light(occlusion_uv);           // 9f4378d49
  return vec4(u_shadow_color * shadow + light.rgb + u_light.rgb * light.a,
              1.0 - (1.0 - shadow) * (1.0 - occlusion));
}
```
`textureLod` is used everywhere because the samples sit inside branches.

*Flat ground* (`drawGround`): runs only when there is no render-to-texture, i.e. terrain is off. In the translucent pass loop of `Painter.render`, just before the layer whose id equals `groundLayer` (the bottom-most casting layer) is drawn, one quad covering the region is drawn. The region is the sun region if there is a sun frame, otherwise the occlusion or lights region. The quad uses program `shadingGround` with `#define SHADING`, depth off, stencil off, `ColorMode.alphaBlended` (premultiplied ONE, ONE_MINUS_SRC_ALPHA) and cull off. `u_matrix = customLayerMainMatrix(non-globe) × regionQuad(region)`, `u_sun_matrix = light × quad` and `u_occlusion_matrix = uv × quad`. `regionQuad` maps the 0–1 unit square to the region at z = 0. Everything drawn earlier in the style (fills, roads, lines below the buildings) is darkened by it.

*Terrain* (draw_terrain.ts): when `shading.shadesGround()` is true (active and at least one of sun/occlusion/lights exists), the terrain program gets `#define SHADING` (alongside `HORIZON_FADE`) plus the receiver uniforms. Per tile it gets `u_sun_matrix = sunMatrix(tileID)` and `u_occlusion_matrix = occlusionMatrix(tileID)`. The vertex shader computes `v_sun = u_sun_matrix * vec4(xy, ele, 1)` and `v_occlusion = (u_occlusion_matrix * vec4(xy, 0, 1)).xy`. The fragment blends the premultiplied shade over the drape texture before fog: `surface.rgb = surface.rgb * (1 − shade.a) + shade.rgb * surface.a`. Because the shade goes on the composited drape, everything draped is shaded at once.

*Shaded extrusions* (draw_fill_extrusion.ts): if `shading.shades(layer)` (shading active and the layer has `cast-shadows`) and the layer uses no pattern, the layer draws with `fillExtrusion` plus `#define SHADING`. When a wall shader is set, its source is injected as a fragment chunk prefixed with `#define SHADING_WALL`. The uniforms are extended with `extrusionUniforms(coord)`. When pitch < 0.001° (plan view), `POLYGON_OFFSET_FILL` with `polygonOffset(0, −8)` is applied so roofless bases win against the ground at equal depth. Pattern layers (`fillExtrusionPattern`) are never shaded.

Vertex shader `SHADING` branch (replaces the stock lighting):
- `wall = a_normal_ed.z < 8192`. `wall_ratio = wall ? t : −1` (t = 1 at the top vertex, −1 on roofs).
- `v_wall = (dot(a_pos + u_wall_origin, normalize(vec2(−n.y, n.x) + 1e-6)) * u_unit_metres, t>0 ? height : base, wall ? height : 0)`.
  - `u_unit_metres = tileMetres / 8192 / within`, where `within = 2^max(0, z − 14)` and `tileMetres` is the metre width of the z14 tile row (`1/(perMetreAt((row + 0.5)/2^min(z,14)) · 2^min(z,14))`).
  - `u_wall_origin = ((x % within)·8192, (y % within)·8192)`.
  - The wall coordinate is therefore measured on the fixed z14 grid, and facades do not jump between zooms.
- `v_facade = (facade_style, hash(vec2(mod(seed, 256), floor(seed/256)) + 0.5))`. `shade_hash` is `fract(vec3(p.xyx)*0.1031)`, `+= dot(q, q.yzx+33.33)`, `fract((q.x+q.y)*q.z)`.
- Foot darkening: `dark = (wall_ratio < 0 || wall_ratio >= band) ? 0 : (exp(−3·wall_ratio/band) − 0.0498) · 1.0524`, and `v_dark = strength · dark`.
- Roofline edge in px: project the wall top and foot via `gl_Position + (h − elevation) * u_projection_matrix[2]`. `wall_px` is their screen distance × `0.5 · u_viewport_size · u_device_pixel_ratio`. `v_edge = (wall_ratio, min(edgeWidth / max(wall_px,1), 0.25), smoothstep(1.5, 4, wall_px / edgeWidth))`.
- Colour: `surface = (!wall && roof_color.a > 0) ? roof_color : color`, then `+0.03`. `directional = mix(1 − I, max(1 − lum + I, 1), clamp(dot(n, u_lightpos), 0, 1))`, where I = `u_lightintensity` (the style's `light`). `v_facing = dot(n, normalize(u_lightpos))`. `rise = wall ? mix(1 − wallRise, 1, sqrt(wall_ratio)) : 1 + roofLift`.
  - `v_color = clamp(surface · directional · mix(skyTint, sunTint, clamp(v_facing,0,1)) · rise)`, with alpha `u_opacity`.
  - `v_ambient = clamp(surface · (1 − I) · skyTint · rise)`.
- `v_sun = u_sun_matrix * vec4(posInTile, elevation, 1)` and `v_light = (u_occlusion_matrix * vec4(posInTile, 0, 1)).xy`.
- The stock vertical gradient and light colour are not applied in this branch. The globe normal rotation is also not applied.

Fragment `SHADING` branch:
```glsl
float edge = v_edge.x < 0.0 ? 0.0 : v_edge.z * (1.0 - smoothstep(0.0, v_edge.y, 1.0 - v_edge.x));
float facing = clamp(v_facing, 0.0, 1.0);
float shade = facing > 0.0 ? sun_shade(v_sun, sqrt(1.0 - facing*facing) / max(facing, 0.2)) : 0.0;
vec3 color = mix(v_color.rgb, v_ambient * 0.9, shade) * (1.0 - v_dark);
#ifdef SHADING_WALL
if (v_wall.z > 0.0) color = shade_wall(color, v_wall, v_facade.y, v_facade.x);
#endif
color *= 1.0 - u_shade_edge * edge;
color += (color + 0.12) * lamp_light(v_light).rgb * exp(-max(v_wall.y, 0.0) / u_light_height);   // 9f4378d49
fragColor = vec4(color * v_color.a, v_color.a);
```
Faces turned away from the light (`facing ≤ 0`) take no shadow test; they are already ambient.

*Extrusion depth program* (`fill_extrusion_depth.vertex/fragment.glsl`, new). Attributes are `a_pos` (loc 0), `a_normal_ed` (loc 1) and, under `TERRAIN3D`, `a_anchor_elevation` (loc 2). It uses the paint attributes `base` and `height`. If `height < 0`, the vertex is moved off-clip, matching the "negative height hides" feature. Otherwise `elevation = (top ? max(0,height) : max(0,base)) + anchorElevation`, and `gl_Position = u_projection_matrix * vec4(a_pos, elevation, 1)`. `fill-extrusion-translate` is not applied. The fragment writes `vec4(1)`. The program has no uniforms of its own (`emptyUniforms`); the matrix comes through the projection block via `projectionOf(matrix)`.

*Terrain on/off.* With terrain off, the ground quad is drawn in the layer stack. With terrain on, the terrain fragment shades the drape and there is no ground quad. Casters' depth uses the terrain anchor elevations. The sun floor follows the terrain height at the centre, rounded to 25 m so the key stays stable.

*Globe.* Nothing in the shading is globe-aware. All matrices are mercator and the ground quad uses `getProjectionDataForCustomLayer(false)`. The `SHADING` extrusion branch drops the globe normal rotation, though `gl_Position` still uses the globe path. Expect shading to be wrong while globe projection is in effect. It only runs at z ≥ `minZoom` (default 14), which is above the zoom where upstream's globe-to-mercator transition normally completes; that is the only protection.

*Program cache.* `Painter.useProgram` gains a `fragmentChunk` argument. It is inserted after the fragment preludes and before the shader's own source; the vertex source is unchanged. Its cache key adds `/<chunkId>`, a small integer per distinct source string. `Program` constructor gains the same parameter.

**Implementation in GL JS.**
- `src/render/shading/shading.ts`: `Shading` class (prepare, updateSun, updateOcclusion, updateLights, blur, drawLit, receive, drawGround, extrusionUniforms, sunMatrix, occlusionMatrix, wallSource, setWallUniforms, destroy).
- `src/render/shading/sun_light.ts`: `multiply`, `tileToMercator`, `perMetreAt`, `steadyRegion`, `regionQuad`, `overheadMatrix`, `CLIP_TO_UV`, `coveredHeight`, `sunLightMatrix`.
- `src/webgl/program/shading_program.ts`: uniform sets `shadingReceiverUniforms`, `shadingMatrixUniforms`, `shadingGroundUniforms`, `shadingBlurUniforms`, `shadedExtrusionUniforms`. `fill_extrusion_program.ts` and `terrain_program.ts` add those uniforms only if the location `u_shade_band` / `u_sun_matrix` exists in the linked program. `program_uniforms.ts` registers `fillExtrusionDepth`, `shadingGround` and `shadingBlur`.
- Shaders: new `fill_extrusion_depth.*`, `shading_ground.*` and `shading_blur.*`; modified `fill_extrusion.*`, `terrain.*` and `_prelude.fragment.glsl`. All are registered in `src/shaders/shaders.ts`.
- `src/render/painter.ts`: `shading` field, `prepare()` call, `drawGround()` hook, `useProgram(…, fragmentChunk)`, `destroy()`.
- `src/webgl/draw/draw_fill_extrusion.ts` and `draw_terrain.ts`, as described.
- `src/data/bucket/fill_extrusion_bucket.ts`: `paintRevision` counter.
- `src/ui/map.ts`: `setShading` / `getShading` and survival across context loss.
- Everything runs on the main thread. The worker is not involved apart from the existing paint attributes for the new data-driven properties.
- Same commit, out of scope here: placement stretch while panning (`style.ts`, `placement.ts`; covered in Performance), and `terrain?.beginFrame?.()` made optional.

**Tests.**
- `src/render/shading/sun_light.test.ts`: `steadyRegion` covers the requested ground and holds still within a cell, then moves once the point leaves it. `sunLightMatrix` keeps the region and its casters inside clip, puts what is nearer the sun at smaller depth, and puts a point and the place its shadow falls in the same texel. Also: a tile corner maps correctly, and the unit square spans the region.
- `src/render/shading/shading.test.ts`: only casting layers are shaded, and only from `minZoom`. Nothing is drawn on the ground with no casters. `visibility(pitch)` is consulted, and 0 draws nothing. Ground effects ramp in over `fadeZoom`. No lamplight is drawn until an intensity is given. The wall shader is handed over as fragment source, or `null`.
- No render tests.

**Native porting notes.**
- Needs GL ES 3 / WebGL2 features: a depth texture with `DEPTH_COMPONENT24` and hardware compare (`sampler2DShadow` with `COMPARE_REF_TO_TEXTURE`), `texStorage2D` immutable mipmapped RGBA8, `textureLod` and `generateMipmap`. No float textures, MRT or MAX blending are needed. On Metal/Vulkan, use a depth texture with a comparison sampler (`MTLSamplerDescriptor.compareFunction = lessEqual`).
- Likely Native counterparts: new offscreen passes in `RenderOrchestrator::createRenderTree` / `Renderer::Impl::render` before the main pass (like `RenderHillshadeLayer`'s prepare pass); `gfx::OffscreenTexture` / `gfx::RenderPass` for the depth map and the 1024² targets; `RenderFillExtrusionLayer::render` for the shaded variant; `RenderTerrain`-type code (if the Native fork has 3D terrain) for terrain receivers; `programs/fill_extrusion_program`, plus new programs for depth, blur and ground; `style/layers/fill_extrusion_layer_properties` for the four new paint properties (generated from the spec JSON in Native, so add them to `style-spec` v8.json).
- The flat-ground quad must be drawn in the translucent pass, before the bottom-most casting fill-extrusion layer. Native's 3D layers render into a separate 3D pass (`RenderFillExtrusionLayer` uses its own depth renderbuffer in some versions). Make sure the ground quad lands in the main colour target, layered under that point of the style.
- The cache-key logic (compare a key array each frame) is what makes camera-only frames cheap. Port it exactly; the steady region's quarter-cell snapping is what keeps the key equal during pans.
- `ShadingCaster` is a JS interface for custom layers drawing with raw WebGL. Native has no direct equivalent: expose a C++ interface (or extend `CustomLayerHost`) with `drawSunDepth/drawOcclusion/drawLights/receive*`, called mid-pass with state set. It is needed only if the native app has custom 3D models.
- The wall shader is app-supplied GLSL concatenated into the fragment source. On Native this needs runtime shader assembly (possible with the GL backend's program cache; hard with precompiled Metal shaders). A built-in facade function may be more practical.
- Fragment prelude uniforms: Native's shaders declare uniforms per program, so `sun_shade` / `ground_occlusion` / `lamp_light` and their uniforms go into a shared include that the terrain, extrusion and ground programs all pull in.
- Texture units 5–7 are reserved during receiver draws. In Native, bind by sampler slot in the program's texture list instead.
- The context-loss handling (moving the `Shading` object across) maps to Native's context-loss and renderer-reset path; recreate the textures lazily there too.

**Commits.** `f6bb4474e` (main), `f9e301cdc` (receiveOcclusion, `GroundOcclusion`, `opacity` in occlusion strength, depth texture created on its own unit).

### Ground occlusion handed to casters; shading textures on their own unit

**Purpose.** Custom-layer models that lie on the ground (bridges, decks) can darken themselves by the same occlusion the ground uses. A texture-unit fault is also fixed.

**API / style-spec surface.** `ShadingCaster.receiveOcclusion?(occlusion: GroundOcclusion)`. New exported type `GroundOcclusion = {uv: Mat4 /* texture coords ← mercator */, texture, strength, power}`.

**Behaviour.** Each frame with an occlusion map, after the maps are ready, every caster receives `{uv, texture: blurred[0].texture, strength, power}`, with the same `strength`/`power` as `u_occlusion_strength`. A caster should darken by `strength * pow(clamp(2 * texel.r, 0, 1), power)` at `uv × mercatorPos`. `occlusionStrength()` was factored out so receivers and the GPU uniform agree. `this.opacity` became part of the product. `depthTexture()` now activates `TEXTURE0 + SUN_SHADOW_UNIT` before creating and binding the depth texture. Otherwise the new depth texture stays bound on whatever unit was active (often 0), where a later colour-sampler draw would fault.

**Implementation in GL JS.** `shading.ts` (`prepare`, `occlusionStrength`, `depthTexture`, `receive`). Export added in `src/index.ts`.

**Tests.** None specific.

**Native porting notes.** In Native the matching rule is to never leave a depth-compare texture bound on a slot a colour sampler reads. Handled naturally if textures are bound per draw by sampler slot.

**Commits.** `f9e301cdc`.

### Lamplight (light map from overhead, building spill)

**Purpose.** A night lever. An additive light map drawn from overhead holds what casters' lamps throw onto the ground (RGB) and what lit buildings spill around their footprints (alpha). The ground, terrain and shaded walls near the ground read it, and casters can receive it.

**API / style-spec surface.**
- `Shading` fields: `lightIntensity` (default `0`; 0 disables the pass), `spillColor` (`[1, 0.8, 0.55]`), `lightBlur` (`3` m), `lightHeight` (`6` m).
- `ShadingCaster.drawLights?(gl, frame: OcclusionFrame)`: draws additively in the lamp's colour, from overhead.
- `ShadingCaster.receiveLights?(lights: GroundLights)`.
- `GroundLights = {uv: Mat4, texture, strength, spillColor}`.
- `WallShader.light?: boolean`. When true, the source must define `float wall_light(float seed, float style, float height)` returning 0–1 spill.
- Uses the existing `fill-extrusion-facade-style` / `-seed` properties. No new spec properties.

**Behaviour.**
- `updateLights` runs when `lightIntensity > 0`. It uses the same `overhead()` region/uv as the occlusion, so both maps share texture coordinates and `u_occlusion_matrix`.
- `sigma = lightBlur · perMetre / (2·half) · 1024` texels.
- Target: an RGBA8 1024² mipmapped `lamps` texture, cleared to transparent.
- If `wallShader.light`, `drawLit` draws each cast tile's footprint with `fillExtrusionDepth` compiled with `#define LIGHT` and the wall source as fragment chunk, unblended, with the wall uniforms set. The vertex passes `v_lit = (facade_style, hash(seed), max(0, height))`. The fragment writes `vec4(0, 0, 0, clamp(wall_light(v_lit.y, v_lit.x, v_lit.z), 0, 1))`, so only alpha carries spill.
- Then, with depth/stencil/cull off and colour mode `ADDED` (blend ONE, ONE in every channel), `caster.drawLights(gl, {matrix: overhead})`.
- `generateMipmap`, then the same two-pass `blur` into `lit[0]`. The blur shader is shared with the occlusion (its comment was updated in this commit).
- `lightStrength = lightIntensity · groundOpacity · opacity`. Uniforms: `u_lights` = unit 7, and `u_light = (spillColor · strength, strength)`.
- Prelude:
  ```glsl
  vec4 lamp_light(vec2 uv) {
    if (u_light.a <= 0.0) return vec4(0.0);
    reach = max(|uv*2-1|); if (reach >= 1.0) return vec4(0.0);
    vec4 light = textureLod(u_lights, uv, 0.0) * (1.0 - smoothstep(0.8, 1.0, reach));
    return vec4(light.rgb * u_light.a, light.a);
  }
  ```
- Ground: `ground_shade` adds `light.rgb + u_light.rgb * light.a` to the premultiplied RGB; alpha is unchanged. The shaded ground can therefore brighten what is below it (premultiplied "over" with added colour).
- Walls: `color += (color + 0.12) * lamp_light(v_light).rgb * exp(−max(v_wall.y, 0) / u_light_height)`. Only the lamp RGB reaches walls, not the spill alpha. `u_light_height = max(lightHeight, 0.01)`.
- `shadesGround()` is true if any of sun, occlusion or lights exists. `occlusionMatrix()` falls back to the lights region when there is no occlusion.
- Lights cache key, as above: the wall shader's object id is included only when it spills.

**Implementation in GL JS.** `shading.ts` (`updateLights`, `drawLit`, `lightStrength`, `LIGHTS_UNIT = 7`, `ADDED` colour mode, `receive`, `destroy`). `_prelude.fragment.glsl` (`u_lights`, `u_light`, `lamp_light`, `ground_shade`). `fill_extrusion.vertex/fragment.glsl` (`v_light`, `u_light_height`). `fill_extrusion_depth.*` (`LIGHT` branch). `shading_blur.fragment.glsl` (comment only). `shading_program.ts` (`u_lights`, `u_light`, `u_light_height`). Export of `GroundLights`.

**Tests.** `shading.test.ts`: with `lightIntensity` at 0, `drawLights` and `receiveLights` are not called, `shadesGround()` is false and `drawn.lights === 0`.

**Native porting notes.** Additive blending (ONE, ONE) into RGBA8 is enough; no float or HDR target is used, so lamp sums clamp at 1. The `LIGHT` variant of the depth program needs the facade paint attributes bound, so it is a separate program variant in Native. It is the same runtime-shader-injection concern as the wall shader.

**Commits.** `9f4378d49`.

### Use in Parchment

- `lib/map/building-shade.ts` calls `map.setShading({minZoom, shadowOffset, casters: shadowCasters, edgeWidth, wallShader: facadeWallShader(...), ...tuning, ...LAMPLIGHT[flavor]})`, and `map.setShading(null)` to turn it off.
  - Dark flavour: `lightIntensity: 0.6, spillColor: [0.5, 0.36, 0.2], lightBlur: 3`; light flavour: `lightIntensity: 0`.
  - The style `light` is set to match the shadow direction (`shadeLight`), because walls read `u_lightpos` from the style light.
  - Fields are retuned live through `getShading()` / the returned object.
- The building layer (`lib/map-style/build.ts`) sets `fill-extrusion-cast-shadows: true` and a `fill-extrusion-facade-seed` from the feature id.
- The wall shader (`lib/map/facade-shader.ts`) defines `shade_wall` and `wall_light`.
- Casters implementing `ShadingCaster`:
  - 3D objects and landmarks (`lib/map-objects/object-layer.ts`, `landmark-layer.ts`): `drawSunDepth`, `drawOcclusion`, `drawLights`, `receiveLights`.
  - Bridge decks (`lib/map-decks/mesh-shadow.ts`, `baked-bridge-layer.ts`): `drawSunDepth`, `drawOcclusion`, `receiveOcclusion`.
  - Tunnels (`lib/map-tunnels/tunnel-layer.ts`): `drawSunDepth`.

## Porting order

1. **Spec plumbing first.** Add every property from `fork_extensions.ts` to Native's spec and regenerate the style code. Nothing else compiles without it.
2. **Line ext buffer.** Variable `line-offset` (with the vector-tile easing and clipping) adds the line's second per-vertex buffer. Line elevation appends `a_elevation` to that buffer and reuses the metres-to-tile-units helper from `line-rounded-corner-distance`, so port offset, then rounded corners, then elevation. Datum heights, draw order, snapping and run paths build on elevation in that order.
3. **Symbol attributes.** `symbol-anchor-offset` and per-feature `symbol-height-anchor` both widen the symbol layout vertex, and the height change moves the anchor-offset attribute. Do them together, after upstream's `symbol-height-offset` and `symbol-height-anchor` exist in Native. Isolated collision layers are independent.
4. **Horizon fade before terrain haze.** The haze calls the fade function. Horizon fade shares `draw_line`'s define list with the line-elevation defines, so it is easiest after step 2. Decal icons and the gamma precision change stand alone.
5. **Terrain.** Drape beneath needs render-to-texture terrain, and must keep elevated lines (step 2) out of the drape. The terrain worker, the elevation-range cache and clipping-mask reuse are independent. The building ground-elevation buffer comes before "anchors on the GPU".
6. **Hiding without reload** is independent, but its muted-layer and negative-height checks recur in the drape pass and the shadow pass, so land it before shading.
7. **Shading last.** It depends on the building ground-elevation buffer (`43e498a61`), on muted layers and negative-height culling (`d8ea3c430`), and with terrain on on the terrain shader. The moving-placement change in the same commit is independent and belongs with performance. Lamplight builds on the shadow pipeline.
8. **Performance items** (tile cache through layer changes, parse-as-read, moving placement) can go at any point. Native's tile pipeline differs most from GL JS here, so start from the behaviour described, not the code.
