import {DepthMode} from '../depth_mode.ts';
import {StencilMode} from '../stencil_mode.ts';
import {ColorMode} from '../color_mode.ts';
import {CullFaceMode} from '../cull_face_mode.ts';
import {
    fillExtrusionUniformValues,
    fillExtrusionPatternUniformValues,
} from '../program/fill_extrusion_program.ts';
import {updatePatternPositionsInProgram} from '../../render/update_pattern_positions_in_program.ts';
import {extend, translatePosition} from '../../util/util.ts';

import type {FrameRenderContext} from '../../render/frame_render_context.ts';
import type {TileManager} from '../../tile/tile_manager.ts';
import type {FillExtrusionStyleLayer} from '../../style/style_layer/fill_extrusion_style_layer.ts';
import type {FillExtrusionBucket} from '../../data/bucket/fill_extrusion_bucket.ts';
import type {OverscaledTileID} from '../../tile/tile_id.ts';

export function drawFillExtrusion(tileManager: TileManager, layer: FillExtrusionStyleLayer, coords: OverscaledTileID[], frameRenderContext: FrameRenderContext): void {
    const opacity = layer.paint.get('fill-extrusion-opacity');
    if (opacity === 0) {
        return;
    }

    if (frameRenderContext.currentPass === 'translucent') {
        const depthMode = new DepthMode(frameRenderContext.context.gl.LEQUAL, DepthMode.ReadWrite, frameRenderContext.depthRangeFor3D);

        if (opacity === 1 && !layer.paint.get('fill-extrusion-pattern').constantOr(1 as any)) {
            const colorMode = frameRenderContext.colorModeForRenderPass();
            drawExtrusionTiles(tileManager, layer, coords, depthMode, StencilMode.disabled, colorMode, frameRenderContext);

        } else {
            // Draw transparent buildings in two passes so that only the closest surface is drawn.
            // First draw all the extrusions into only the depth buffer. No colors are drawn.
            drawExtrusionTiles(tileManager, layer, coords, depthMode,
                StencilMode.disabled,
                ColorMode.disabled, frameRenderContext);

            // Then draw all the extrusions a second type, only coloring fragments if they have the
            // same depth value as the closest fragment in the previous pass. Use the stencil buffer
            // to prevent the second draw in cases where we have coincident polygons.
            drawExtrusionTiles(tileManager, layer, coords, depthMode,
                frameRenderContext.stencilModeFor3D(),
                frameRenderContext.colorModeForRenderPass(), frameRenderContext);
        }
    }
}

function drawExtrusionTiles(
    tileManager: TileManager,
    layer: FillExtrusionStyleLayer,
    coords: OverscaledTileID[],
    depthMode: DepthMode,
    stencilMode: Readonly<StencilMode>,
    colorMode: Readonly<ColorMode>,
    frameRenderContext: FrameRenderContext) {
    const context = frameRenderContext.context;
    const gl = context.gl;
    const fillPropertyName = 'fill-extrusion-pattern';
    const patternProperty = layer.paint.get(fillPropertyName);
    const image = patternProperty.constantOr(1 as any);
    const crossfade = layer.getCrossfadeParameters();
    const opacity = layer.paint.get('fill-extrusion-opacity');
    const constantPattern = patternProperty.constantOr(null);
    const projectedCamera = frameRenderContext.projectedCamera;
    const shading = !image && frameRenderContext.shading?.shades(layer) ? frameRenderContext.shading : null;
    // Looking straight down, the ground and a roofless base share a depth: the extrusions are drawn to win.
    const planView = !!shading && Math.abs(projectedCamera.pitch) < 0.001;
    if (planView) {
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(0, -8);
    }

    for (const coord of coords) {
        const tile = tileManager.getTile(coord);
        const bucket: FillExtrusionBucket = (tile.getBucket(layer) as any);
        if (!bucket) continue;

        const terrainData = frameRenderContext.getTerrainDataForTile(coord);
        const programConfiguration = bucket.programConfigurations.get(layer.id);
        const program = shading ?
            frameRenderContext.useProgram('fillExtrusion', programConfiguration, false, ['#define SHADING'], shading.wallSource() ?? '') :
            frameRenderContext.useProgram(image ? 'fillExtrusionPattern' : 'fillExtrusion', programConfiguration);

        if (image) {
            context.activeTexture.set(gl.TEXTURE0);
            tile.imageAtlasTexture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);
            programConfiguration.updatePaintBuffers(crossfade);
        }

        const projectionData = frameRenderContext.getProjectionDataForTile(coord);
        updatePatternPositionsInProgram(programConfiguration, fillPropertyName, constantPattern, tile, layer);

        const translate = translatePosition(
            projectedCamera,
            tile,
            layer.paint.get('fill-extrusion-translate'),
            layer.paint.get('fill-extrusion-translate-anchor')
        );

        const shouldUseVerticalGradient = layer.paint.get('fill-extrusion-vertical-gradient');
        const uniformValues = image ?
            fillExtrusionPatternUniformValues(projectedCamera, frameRenderContext.data.light, shouldUseVerticalGradient, opacity, translate, coord, crossfade, tile) :
            fillExtrusionUniformValues(projectedCamera, frameRenderContext.data.light, shouldUseVerticalGradient, opacity, translate);
        if (shading && !program.failedToCreate) {
            extend(uniformValues, shading.extrusionUniforms(coord));
            context.program.set(program.program);
            shading.setWallUniforms(program.program);
        }

        program.draw(context, context.gl.TRIANGLES, depthMode, stencilMode, colorMode, CullFaceMode.backCCW,
            uniformValues, terrainData, projectionData, layer.id, bucket.layoutVertexBuffer, bucket.indexBuffer,
            bucket.segments, layer.paint, frameRenderContext.projectedCamera.zoom,
            programConfiguration, frameRenderContext.terrain?.getAnchorElevations(bucket, coord));
    }
    if (planView) {
        gl.polygonOffset(0, 0);
        gl.disable(gl.POLYGON_OFFSET_FILL);
    }
}
