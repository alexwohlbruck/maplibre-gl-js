import {DepthMode} from '../depth_mode.ts';
import {CullFaceMode} from '../cull_face_mode.ts';
import {StencilMode} from '../stencil_mode.ts';
import {Texture} from '../texture.ts';
import {
    lineUniformValues,
    linePatternUniformValues,
    lineSDFUniformValues,
    lineGradientUniformValues,
    lineGradientSDFUniformValues
} from '../program/line_program.ts';
import {clamp, nextPowerOfTwo} from '../../util/util.ts';
import {renderColorRamp} from '../../util/color_ramp.ts';
import {EXTENT} from '../../data/extent.ts';
import {drawLayerComposite, prepareDrawLayerComposite} from './draw_layer_composite.ts';
import {getCameraMath} from '../../camera/camera_math_factory.ts';
import {horizonFadeDefines} from './horizon_fade.ts';
import {tileFadeDefines} from './tile_fade.ts';

import type {FrameRenderContext} from '../../render/frame_render_context.ts';
import type {Painter} from '../../render/painter.ts';
import type {TileManager} from '../../tile/tile_manager.ts';
import type {LineStyleLayer} from '../../style/style_layer/line_style_layer.ts';
import type {LineBucket} from '../../data/bucket/line_bucket.ts';
import type {OverscaledTileID} from '../../tile/tile_id.ts';
import type {Tile} from '../../tile/tile.ts';
import type {Context} from '../context.ts';
import type {ProgramConfiguration} from '../../data/program_configuration.ts';
import type {RGBAImage} from '../../util/image.ts';

type GradientTexture = {
    texture?: Texture;
    gradient?: RGBAImage;
    version?: number;
};

function updateGradientTexture(
    tileManager: TileManager,
    context: Context,
    gl: WebGLRenderingContext,
    layer: LineStyleLayer,
    bucket: LineBucket,
    coord: OverscaledTileID,
    layerGradient: GradientTexture,
    frameRenderContext: FrameRenderContext
): Texture {
    let textureResolution = 256;
    if (layer.stepInterpolant) {
        const sourceMaxZoom = tileManager.getSource().maxzoom;
        const potentialOverzoom = coord.canonical.z === sourceMaxZoom ?
            Math.ceil(1 << (frameRenderContext.projectedCamera.maxZoom - coord.canonical.z)) : 1;
        const lineLength = bucket.maxLineLength / EXTENT;
        // Logical pixel tile size is 512px, and 1024px right before current zoom + 1
        const maxTilePixelSize = 1024;
        // Maximum possible texture coverage heuristic, bound by hardware max texture size
        const maxTextureCoverage = lineLength * maxTilePixelSize * potentialOverzoom;
        textureResolution = clamp(nextPowerOfTwo(maxTextureCoverage), 256, context.maxTextureSize);
    }
    layerGradient.gradient = renderColorRamp({
        expression: layer.gradientExpression(),
        evaluationKey: 'lineProgress',
        resolution: textureResolution,
        image: layerGradient.gradient || undefined,
        clips: bucket.lineClipsArray
    });
    if (layerGradient.texture) {
        layerGradient.texture.update(layerGradient.gradient);
    } else {
        layerGradient.texture = new Texture(context, layerGradient.gradient, gl.RGBA);
    }
    layerGradient.version = layer.gradientVersion;
    return layerGradient.texture;
}

function bindImagePatternTextures(
    context: Context,
    gl: WebGLRenderingContext,
    tile: Tile,
    programConfiguration: ProgramConfiguration,
    crossfade: ReturnType<LineStyleLayer['getCrossfadeParameters']>
) {
    context.activeTexture.set(gl.TEXTURE0);
    tile.imageAtlasTexture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);
    programConfiguration.updatePaintBuffers(crossfade);
}

function bindDasharrayTextures(
    painter: Painter,
    context: Context,
    gl: WebGLRenderingContext,
    programConfiguration: ProgramConfiguration,
    programChanged: boolean,
    crossfade: ReturnType<LineStyleLayer['getCrossfadeParameters']>
) {
    if (programChanged || painter.lineAtlas.dirty) {
        context.activeTexture.set(gl.TEXTURE0);
        painter.lineAtlas.bind(context);
    }
    programConfiguration.updatePaintBuffers(crossfade);
}

function bindGradientTextures(
    tileManager: TileManager,
    context: Context,
    gl: WebGLRenderingContext,
    layer: LineStyleLayer,
    bucket: LineBucket,
    coord: OverscaledTileID,
    frameRenderContext: FrameRenderContext
) {
    const layerGradient = bucket.gradients[layer.id];
    let gradientTexture = layerGradient.texture;
    if (layer.gradientVersion !== layerGradient.version) {
        gradientTexture = updateGradientTexture(tileManager, context, gl, layer, bucket, coord, layerGradient, frameRenderContext);
    }
    context.activeTexture.set(gl.TEXTURE0);
    gradientTexture.bind(layer.stepInterpolant ? gl.NEAREST : gl.LINEAR, gl.CLAMP_TO_EDGE);
}

function bindGradientAndDashTextures(
    painter: Painter,
    tileManager: TileManager,
    context: Context,
    gl: WebGLRenderingContext,
    layer: LineStyleLayer,
    bucket: LineBucket,
    coord: OverscaledTileID,
    programConfiguration: ProgramConfiguration,
    crossfade: ReturnType<LineStyleLayer['getCrossfadeParameters']>,
    frameRenderContext: FrameRenderContext
) {
    // Bind gradient texture to TEXTURE0
    const layerGradient = bucket.gradients[layer.id];
    let gradientTexture = layerGradient.texture;
    if (layer.gradientVersion !== layerGradient.version) {
        gradientTexture = updateGradientTexture(tileManager, context, gl, layer, bucket, coord, layerGradient, frameRenderContext);
    }
    context.activeTexture.set(gl.TEXTURE0);
    gradientTexture.bind(layer.stepInterpolant ? gl.NEAREST : gl.LINEAR, gl.CLAMP_TO_EDGE);

    // Bind dash atlas to TEXTURE1
    context.activeTexture.set(gl.TEXTURE1);
    painter.lineAtlas.bind(context);

    programConfiguration.updatePaintBuffers(crossfade);
}

export function drawLine(painter: Painter, tileManager: TileManager, layer: LineStyleLayer, coords: OverscaledTileID[], frameRenderContext: FrameRenderContext): void {
    if (frameRenderContext.currentPass !== 'translucent') return;

    const opacity = layer.paint.get('line-opacity');
    const width = layer.paint.get('line-width');
    const layerOpacity = layer.paint.get('line-layer-opacity');
    if (opacity.constantOr(1) === 0 || width.constantOr(1) === 0 || layerOpacity === 0) return;

    const passes = linePasses(layer, frameRenderContext);
    if (!passes.length) return;

    const layerBlend = layer.paint.get('line-layer-blend');
    if (layerOpacity < 1 || layerBlend !== 'normal') {
        const results = prepareDrawLayerComposite(painter, tileManager, layer, coords, frameRenderContext);
        for (const pass of passes) drawLineTiles(painter, tileManager, layer, coords, frameRenderContext, pass);
        drawLayerComposite(painter, layerOpacity, layerBlend, results, layer, frameRenderContext);
        return;
    }

    for (const pass of passes) drawLineTiles(painter, tileManager, layer, coords, frameRenderContext, pass);
}

type LinePass = 'flat' | 'underground' | 'overground' | 'unoccluded';

/**
 * How a line is drawn now. An elevated one is drawn underground with no depth test, so the terrain over it does not hide
 * it but what stands on the ground still may, and over the ground tested against the depth of everything 3D. One
 * that is never occluded is drawn whole, untested, last.
 */
function linePasses(layer: LineStyleLayer, frameRenderContext: FrameRenderContext): LinePass[] {
    if (!layer.isElevated() || !frameRenderContext.terrain) return ['flat'];
    if (layer.paint.get('line-depth-occlusion-factor') === 0) return frameRenderContext.elevatedPass === 'underground' ? [] : ['unoccluded'];
    return frameRenderContext.elevatedPass ? [frameRenderContext.elevatedPass] : ['underground', 'overground'];
}

function drawLineTiles(
    painter: Painter,
    tileManager: TileManager,
    layer: LineStyleLayer,
    coords: OverscaledTileID[],
    frameRenderContext: FrameRenderContext,
    pass: LinePass
) {
    // Raised off the terrain, a line is drawn in 3D among the extrusions and custom layers rather than draped.
    const elevated = pass !== 'flat';
    const depthMode = pass === 'flat' ? frameRenderContext.getDepthModeForSublayer(0, DepthMode.ReadOnly) :
        pass === 'overground' ? new DepthMode(frameRenderContext.context.gl.LEQUAL, DepthMode.ReadOnly, frameRenderContext.depthRangeFor3D) :
            DepthMode.disabled;
    const defines = [...horizonFadeDefines(layer), ...tileFadeDefines(layer), ...(!elevated ? [] : [
        '#define LINE_ELEVATION',
        ...(layer.paint.get('line-pitch-alignment') === 'viewport' ? ['#define LINE_VIEWPORT'] : []),
        ...(pass === 'underground' ? ['#define LINE_UNDERGROUND'] : pass === 'overground' ? ['#define LINE_OVERGROUND'] : []),
    ])];
    const colorMode = frameRenderContext.colorModeForRenderPass();

    const dasharrayProperty = layer.paint.get('line-dasharray');
    const dasharray = dasharrayProperty.constantOr(1 as any);
    const patternProperty = layer.paint.get('line-pattern');
    const image = patternProperty.constantOr(1 as any);

    const gradient = layer.paint.get('line-gradient');
    const crossfade = layer.getCrossfadeParameters();

    // A `line-progress`-driven `line-offset` varies the offset per-vertex; it needs a dedicated
    // shader variant that reads `a_line_offset` from the ext buffer. Only applies when the line
    // isn't already a pattern/SDF/gradient variant (those have their own vertex shaders).
    const variableOffset = layer.hasVariableOffset();

    let programId: string;
    if (image) programId = 'linePattern';
    else if (dasharray && gradient) programId = 'lineGradientSDF';
    else if (dasharray) programId = 'lineSDF';
    else if (gradient) programId = 'lineGradient';
    else if (variableOffset) programId = 'lineVariableOffset';
    else programId = 'line';

    const context = frameRenderContext.context;
    const gl = context.gl;
    const projectedCamera = frameRenderContext.projectedCamera;

    let firstTile = true;

    for (const coord of coords) {
        const tile = tileManager.getTile(coord);

        if (image && !tile.patternsLoaded()) continue;

        const bucket: LineBucket = (tile.getBucket(layer) as any);
        if (!bucket) continue;
        // A bucket parsed before the layer took its profile has no heights to draw with.
        if (elevated && !bucket.layoutVertexBuffer2) continue;

        const programConfiguration = bucket.programConfigurations.get(layer.id);
        const prevProgram = context.program.get();
        const program = frameRenderContext.useProgram(programId, programConfiguration, false, defines);
        program.tileFade = painter.tileFades.factor(layer, tileManager, tile);
        const programChanged = firstTile || program.program !== prevProgram;
        const terrainData = frameRenderContext.getTerrainDataForTile(coord);

        const constantPattern = patternProperty.constantOr(null);
        const constantDasharray = dasharrayProperty?.constantOr(null);

        if (constantPattern && tile.imageAtlas) {
            const atlas = tile.imageAtlas;
            const posTo = atlas.patternPositions[constantPattern.to.toString()];
            const posFrom = atlas.patternPositions[constantPattern.from.toString()];
            if (posTo && posFrom) programConfiguration.setConstantPatternPositions(posTo, posFrom);
        } else if (constantDasharray) {
            const round = layer.layout.get('line-cap').constantOr(null) === 'round';
            const dashTo = painter.lineAtlas.getDash(constantDasharray.to, round);
            const dashFrom = painter.lineAtlas.getDash(constantDasharray.from, round);
            programConfiguration.setConstantDashPositions(dashTo, dashFrom);
        }

        const projectionData = frameRenderContext.getProjectionDataForTile(coord);

        const pixelRatio = getCameraMath(projectedCamera).getPixelScale(projectedCamera);

        let uniformValues;
        if (image) {
            uniformValues = linePatternUniformValues(projectedCamera, tile, layer, pixelRatio, crossfade);
            bindImagePatternTextures(context, gl, tile, programConfiguration, crossfade);
        } else if (dasharray && gradient) {
            uniformValues = lineGradientSDFUniformValues(projectedCamera, painter.lineAtlas, tile, layer, pixelRatio, crossfade, bucket.lineClipsArray.length);
            bindGradientAndDashTextures(painter, tileManager, context, gl, layer, bucket, coord, programConfiguration, crossfade, frameRenderContext);
        } else if (dasharray) {
            uniformValues = lineSDFUniformValues(projectedCamera, painter.lineAtlas, tile, layer, pixelRatio, crossfade);
            bindDasharrayTextures(painter, context, gl, programConfiguration, programChanged, crossfade);
        } else if (gradient) {
            uniformValues = lineGradientUniformValues(projectedCamera, tile, layer, pixelRatio, bucket.lineClipsArray.length);
            bindGradientTextures(tileManager, context, gl, layer, bucket, coord, frameRenderContext);
        } else {
            uniformValues = lineUniformValues(projectedCamera, tile, layer, pixelRatio);
        }

        // The tile's clipping mask lies flat at sea level; an elevated line clips itself to its tile instead.
        const stencil = elevated ? StencilMode.disabled : frameRenderContext.stencilModeForClipping(coord);

        program.draw(context, gl.TRIANGLES, depthMode,
            stencil, colorMode, CullFaceMode.disabled, uniformValues, terrainData, projectionData,
            layer.id, bucket.layoutVertexBuffer, bucket.indexBuffer, bucket.segments,
            layer.paint, frameRenderContext.projectedCamera.zoom, programConfiguration, bucket.layoutVertexBuffer2);

        firstTile = false;
        // once refactored so that bound texture state is managed, we'll also be able to remove this firstTile/programChanged logic
    }
}
