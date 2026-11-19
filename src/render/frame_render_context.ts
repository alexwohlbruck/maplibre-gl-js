import {Color} from '@maplibre/maplibre-gl-style-spec';
import {TileManager} from '../tile/tile_manager.ts';
import {DepthMode} from '../webgl/depth_mode.ts';
import {ColorMode} from '../webgl/color_mode.ts';
import {StencilMode} from '../webgl/stencil_mode.ts';
import {CullFaceMode} from '../webgl/cull_face_mode.ts';
import {shaders} from '../shaders/shaders.ts';
import {MercatorShaderDefine, MercatorShaderVariantKey} from '../geo/projection/mercator_projection.ts';
import {getCameraMath} from '../camera/camera_math_factory.ts';

import type {Terrain, TerrainData} from './terrain.ts';
import type {RendererProjectionData} from '../geo/projection/projection_data.ts';
import type {CanonicalTileID, OverscaledTileID} from '../tile/tile_id.ts';
import type {DepthRangeType, DepthMaskType, DepthFuncType} from '../webgl/types.ts';
import type {Context} from '../webgl/context.ts';
import type {Program} from '../webgl/program.ts';
import type {ProgramCache} from '../webgl/program_cache.ts';
import type {ProgramConfiguration} from '../data/program_configuration.ts';
import type {PreparedShader} from '../shaders/shaders.ts';
import type {Mesh} from './mesh.ts';
import type {StyleLayer} from '../style/style_layer.ts';
import type {LightPropsPossiblyEvaluated} from '../style/light_properties.g.ts';
import type {SkyPropsPossiblyEvaluated} from '../style/sky_properties.g.ts';
import type {Projection, TileMeshUsage} from '../geo/projection/projection.ts';
import type {CrossTileID, VariableOffset} from '../symbol/placement.ts';
import type {ProjectedCamera} from '../camera/projected_camera.ts';
import type {WorldCoordinateHelper} from '../geo/world_types.ts';
import type {Shading} from './shading/shading.ts';

export type RenderPass = 'offscreen' | 'opaque' | 'translucent';

/** Which part of an elevated line to draw: under the terrain at its place in the style, or over it once the 3D layers are drawn. */
export type ElevatedPass = 'underground' | 'overground';

/** The code a projection adds to every shader, and the name that tells its programs apart. */
export type ProjectionShaderVariant = {
    readonly name: string;
    readonly define: string;
    readonly prelude: PreparedShader;
};

/** Plain values that describe one frame. The map builds them once per frame. */
export type FrameRenderData = {
    readonly showOverdrawInspector: boolean;
    readonly showTileBoundaries: boolean;
    readonly showPadding: boolean;
    readonly rotating: boolean;
    readonly zooming: boolean;
    readonly moving: boolean;
    readonly fadeDuration: number;
    /** Progress of the symbol fade since the last placement. */
    readonly symbolFadeChange: number;
    /** The anchors the last placement chose for symbols with variable anchors. */
    readonly variableOffsets: Readonly<Record<CrossTileID, VariableOffset>>;
    readonly anisotropicFilterPitch: number;
    readonly projectionTransition: number;
    readonly isRenderingGlobe: boolean;
    /** The projection's shader variant for this frame, undefined until the style has a projection. Globe switches it during its transition. */
    readonly projectionShaderVariant: ProjectionShaderVariant | undefined;
    /** Whether the projection subdivides tile meshes this frame. */
    readonly useSubdivision: boolean;
    /** Drawing buffer pixels per CSS pixel, after the map clamps it to the largest canvas the GPU supports. */
    readonly pixelRatio: number;
    /** The style's light, evaluated for this frame, undefined until the style has loaded. */
    readonly light: Readonly<LightPropsPossiblyEvaluated> | undefined;
    /** The style's sky, evaluated for this frame, undefined until the style has loaded. */
    readonly sky: Readonly<SkyPropsPossiblyEvaluated> | undefined;
};

type FrameRenderContextOptions = {
    projectedCamera: ProjectedCamera;
    /** The world mapping the camera was projected with. */
    worldCoordinateHelper: WorldCoordinateHelper;
    terrain: Terrain | null;
    data: FrameRenderData;
    context: Context;
    programCache: ProgramCache;
    currentPass: RenderPass;
    /** The projection that builds the tile meshes, undefined until the style has one. */
    projection: Projection | undefined;
    /** The map's shading, null while it is off. */
    shading?: Shading | null;
};

/** Distinct z-planes within each layer that can be drawn to, implemented with the WebGL depth buffer. */
const NUM_SUBLAYERS: number = TileManager.maxOverzooming + TileManager.maxUnderzooming + 1;

/** Depth distance between two neighboring sublayers. */
const DEPTH_EPSILON: number = 1 / Math.pow(2, 16);

/** The mercator variant, for draws that force the simple projection, like fullscreen quads. */
const MERCATOR_SHADER_VARIANT: ProjectionShaderVariant = {
    name: MercatorShaderVariantKey,
    define: MercatorShaderDefine,
    prelude: shaders.projectionMercator
};

/**
 * @internal
 * The state of one frame, created per render and updated as rendering proceeds.
 * Corresponds to part of MapLibre Native's `PaintParameters`.
 */
export class FrameRenderContext {
    currentPass: RenderPass;
    currentLayer: number = 0;
    opaquePassCutoff: number = Infinity;
    depthRangeFor3D: DepthRangeType = [0, 1];
    isRenderingToTexture: boolean = false;
    /** Whether a layer composite has already sampled the shared scratch FBO in this frame. */
    layerCompositeSampled: boolean = false;
    /** Which part of an elevated line to draw, see {@link ElevatedPass}. Both when unset. */
    elevatedPass?: ElevatedPass;
    readonly projectedCamera: ProjectedCamera;
    /** The world mapping the camera was projected with. */
    readonly worldCoordinateHelper: WorldCoordinateHelper;
    readonly terrain: Terrain | null;
    readonly data: FrameRenderData;
    readonly context: Context;
    readonly programCache: ProgramCache;
    /** The map's shading, null while it is off: see {@link Shading}. */
    readonly shading: Shading | null;
    private readonly projection: Projection | undefined;
    /** The source whose clipping masks are in the stencil buffer. */
    private currentStencilSource: string;
    private nextStencilID: number = 1;
    private tileClippingMaskIDs: Record<string, number> = {};
    /** Stencil ref of every tile area whose clipping mask is still whole in the stencil buffer. */
    private intactClippingMasks: Map<string, {tileID: OverscaledTileID; ref: number}> = new Map();

    constructor(options: FrameRenderContextOptions) {
        this.projectedCamera = options.projectedCamera;
        this.worldCoordinateHelper = options.worldCoordinateHelper;
        this.terrain = options.terrain;
        this.data = options.data;
        this.context = options.context;
        this.programCache = options.programCache;
        this.currentPass = options.currentPass;
        this.projection = options.projection;
        this.shading = options.shading ?? null;
    }

    getProjectionDataForTile(tileID: OverscaledTileID, options: {aligned?: boolean; applyTerrainMatrix?: boolean} = {}): RendererProjectionData {
        const projectionData = getCameraMath(this.projectedCamera).getProjectionData(this.projectedCamera, {
            overscaledTileID: tileID,
            aligned: options.aligned,
            applyGlobeMatrix: !this.isRenderingToTexture,
            applyTerrainMatrix: options.applyTerrainMatrix ?? true
        });
        if (this.isRenderingToTexture) return projectionData;

        projectionData.uniformBufferKey = options.aligned ? `${tileID.key}/aligned` : tileID.key;
        return projectionData;
    }

    /**
     * Returns terrain data for a tile.
     * Returns null if terrain is not configured or tiles are being rendered to a texture.
     */
    getTerrainDataForTile(tileID: OverscaledTileID): TerrainData | null {
        if (this.isRenderingToTexture) return null;
        return this.terrain?.getTerrainData(tileID) ?? null;
    }

    /** Returns the mesh the projection draws a tile with. */
    getMeshFromTileID(tileID: CanonicalTileID, hasBorder: boolean, allowPoles: boolean, usage: TileMeshUsage): Mesh {
        return this.projection.getMeshFromTileID(this.context, tileID, hasBorder, allowPoles, usage);
    }

    /**
     * Finds the required shader and its variant (base/terrain/globe, etc.) and binds it, compiling a new shader if required.
     * @param name - Name of the desired shader.
     * @param programConfiguration - Configuration of shader's inputs.
     * @param forceSimpleProjection - Whether to force the use of a shader variant with simple mercator projection vertex shader.
     * False by default. Use true when drawing with a simple projection matrix is desired, eg. when drawing a fullscreen quad.
     * @param defines - Additional macros to be injected at the beginning of the shader. Expected format is `['#define XYZ']`, etc.
     * @param fragmentChunk - Source set before the fragment shader's own, after the preludes: functions it calls.
     */
    useProgram(name: string, programConfiguration?: ProgramConfiguration | null, forceSimpleProjection: boolean = false, defines: string[] = [], fragmentChunk: string = ''): Program<any> {
        return this.programCache.getProgram({
            name,
            programConfiguration,
            projectionShaderVariant: forceSimpleProjection ? MERCATOR_SHADER_VARIANT : this.data.projectionShaderVariant,
            showOverdrawInspector: this.data.showOverdrawInspector,
            useTerrain: this.terrain !== null,
            defines,
            fragmentChunk
        });
    }

    colorModeForRenderPass(): Readonly<ColorMode> {
        const gl = this.context.gl;
        if (this.data.showOverdrawInspector) {
            const numOverdrawSteps = 8;
            const a = 1 / numOverdrawSteps;

            return new ColorMode([gl.CONSTANT_COLOR, gl.ONE], new Color(a, a, a, 0), [true, true, true, true]);
        } else if (this.currentPass === 'opaque') {
            return ColorMode.unblended;
        } else {
            return ColorMode.alphaBlended;
        }
    }

    getDepthModeForSublayer(n: number, mask: DepthMaskType, func?: DepthFuncType | null): Readonly<DepthMode> {
        if (!this.opaquePassEnabledForLayer()) return DepthMode.disabled;
        const depth = 1 - ((1 + this.currentLayer) * NUM_SUBLAYERS + n) * DEPTH_EPSILON;
        return new DepthMode(func || this.context.gl.LEQUAL, mask, [depth, depth]);
    }

    getDepthModeFor3D(): Readonly<DepthMode> {
        return new DepthMode(this.context.gl.LEQUAL, DepthMode.ReadWrite, this.depthRangeFor3D);
    }

    /** Sets the depth range that 3D layers draw into, which lies below the depth values of every sublayer of the `layerCount` layers. */
    setDepthRangeFor3D(layerCount: number): void {
        this.depthRangeFor3D = [0, 1 - ((layerCount + 2) * NUM_SUBLAYERS * DEPTH_EPSILON)];
    }

    /**
     * Returns whether the current layer can be drawn in the opaque pass. The opaque pass and 3D layers both use the depth buffer,
     * so layers drawn above 3D layers use the painter's algorithm to appear above 3D features.
     */
    opaquePassEnabledForLayer(): boolean {
        return this.currentLayer < this.opaquePassCutoff;
    }

    /**
     * Reset the drawing canvas by clearing the stencil buffer so that we can draw
     * new tiles at the same location, while retaining previously drawn pixels.
     */
    clearStencil(): void {
        this.nextStencilID = 1;
        this.currentStencilSource = undefined;
        this.context.clear({stencil: 0});
    }

    /** Makes the next tile-clipped layer draw its clipping masks again. */
    invalidateTileClippingMasks(): void {
        this.currentStencilSource = undefined;
    }

    /**
     * Draws the clipping masks of a layer's tiles into the stencil buffer, unless its source's masks are already there.
     *
     * A clipping mask depends only on a tile's area, not on its source, so masks another source left behind are
     * reused and only the missing ones are drawn. Anything else that writes the stencil resets the current source,
     * which discards them all. Subdivided meshes and tile sets that overlap themselves are always drawn whole.
     */
    renderTileClippingMasks(layer: StyleLayer, tileIDs: OverscaledTileID[]): void {
        if (this.currentStencilSource === layer.source || !layer.isTileClipped() || !tileIDs?.length) {
            return;
        }

        const intact = this.intactClippingMasks;
        if (this.currentStencilSource === undefined) intact.clear();
        this.currentStencilSource = layer.source;

        let missing = tileIDs.filter(tileID => !intact.has(clippingMaskArea(tileID)));
        if (missing.length && (this.data.useSubdivision || hasOverlappingTiles(tileIDs))) {
            missing = tileIDs;
        }

        if (this.nextStencilID + missing.length > 256) {
            this.clearStencil();
            this.currentStencilSource = layer.source;
            intact.clear();
            missing = tileIDs;
        }

        const stencilRefs: Record<string, number> = {};
        for (const tileID of tileIDs) {
            stencilRefs[tileID.key] = intact.get(clippingMaskArea(tileID))?.ref;
        }
        this.tileClippingMaskIDs = stencilRefs;
        if (!missing.length) return;

        const context = this.context;
        context.setColorMode(ColorMode.disabled);
        context.setDepthMode(DepthMode.disabled);

        for (const tileID of missing) {
            const ref = this.nextStencilID++;
            stencilRefs[tileID.key] = ref;
            for (const [area, mask] of intact) {
                if (tilesOverlap(mask.tileID, tileID)) intact.delete(area);
            }
            intact.set(clippingMaskArea(tileID), {tileID, ref});
        }

        if (this.data.useSubdivision) {
            this.renderTileMasks(stencilRefs, missing, true);
        }
        this.renderTileMasks(stencilRefs, missing, false);
    }

    private renderTileMasks(tileStencilRefs: Record<string, number>, tileIDs: OverscaledTileID[], useBorders: boolean): void {
        const context = this.context;
        const gl = context.gl;
        const program = this.useProgram('clippingMask');

        for (const tileID of tileIDs) {
            const stencilRef = tileStencilRefs[tileID.key];
            const terrainData = this.getTerrainDataForTile(tileID);
            const mesh = this.getMeshFromTileID(tileID.canonical, useBorders, true, 'stencil');
            const projectionData = this.getProjectionDataForTile(tileID);

            program.draw(context, gl.TRIANGLES, DepthMode.disabled,
                new StencilMode({func: gl.ALWAYS, mask: 0}, stencilRef, 0xFF, gl.KEEP, gl.KEEP, gl.REPLACE),
                ColorMode.disabled, this.isRenderingToTexture ? CullFaceMode.disabled : CullFaceMode.backCCW, null,
                terrainData, projectionData, '$clipping', mesh.vertexBuffer,
                mesh.indexBuffer, mesh.segments);
        }
    }

    /** Returns a stencil mode that draws each pixel of a 3D layer only once. */
    stencilModeFor3D(): StencilMode {
        this.currentStencilSource = undefined;

        if (this.nextStencilID + 1 > 256) {
            this.clearStencil();
        }

        const id = this.nextStencilID++;
        const gl = this.context.gl;
        return new StencilMode({func: gl.NOTEQUAL, mask: 0xFF}, id, 0xFF, gl.KEEP, gl.KEEP, gl.REPLACE);
    }

    stencilModeForClipping(tileID: OverscaledTileID): StencilMode {
        const gl = this.context.gl;
        return new StencilMode({func: gl.EQUAL, mask: 0xFF}, this.tileClippingMaskIDs[tileID.key], 0x00, gl.KEEP, gl.KEEP, gl.REPLACE);
    }

    /**
     * Sort coordinates by Z as drawing tiles is done in Z-descending order.
     * All children with the same Z write the same stencil value.  Children
     * stencil values are greater than parent's.  This is used only for raster
     * and raster-dem tiles, which are already clipped to tile boundaries, to
     * mask area of tile overlapped by children tiles.
     * Stencil ref values continue the range used by the tile clipping masks.
     *
     * Attention: This function changes the next stencil ID even if the result of it
     * is not used, which might cause problems when rendering due to invalid stencil
     * values.
     * Returns [StencilMode for tile overscaleZ map, sortedCoords].
     */
    getStencilConfigForOverlapAndUpdateStencilID(tileIDs: OverscaledTileID[]): [Record<number, Readonly<StencilMode>>, OverscaledTileID[]] {
        const gl = this.context.gl;
        const coords = tileIDs.sort((a, b) => b.overscaledZ - a.overscaledZ);
        const minTileZ = coords[coords.length - 1].overscaledZ;
        const stencilValues = coords[0].overscaledZ - minTileZ + 1;
        if (stencilValues > 1) {
            this.currentStencilSource = undefined;
            if (this.nextStencilID + stencilValues > 256) {
                this.clearStencil();
            }
            const zToStencilMode: Record<number, Readonly<StencilMode>> = {};
            for (let i = 0; i < stencilValues; i++) {
                zToStencilMode[i + minTileZ] = new StencilMode({func: gl.GEQUAL, mask: 0xFF}, i + this.nextStencilID, 0xFF, gl.KEEP, gl.KEEP, gl.REPLACE);
            }
            this.nextStencilID += stencilValues;
            return [zToStencilMode, coords];
        }
        return [{[minTileZ]: StencilMode.disabled}, coords];
    }

    stencilConfigForOverlapTwoPass(tileIDs: OverscaledTileID[]): [
        Record<number, Readonly<StencilMode>>, // borderless tiles - high priority & high stencil values
        Record<number, Readonly<StencilMode>>, // tiles with border - low priority
        OverscaledTileID[]
    ] {
        const gl = this.context.gl;
        const coords = tileIDs.sort((a, b) => b.overscaledZ - a.overscaledZ);
        const minTileZ = coords[coords.length - 1].overscaledZ;
        const stencilValues = coords[0].overscaledZ - minTileZ + 1;

        this.clearStencil();

        if (stencilValues > 1) {
            const zToStencilModeHigh: Record<number, Readonly<StencilMode>> = {};
            const zToStencilModeLow: Record<number, Readonly<StencilMode>> = {};
            for (let i = 0; i < stencilValues; i++) {
                zToStencilModeHigh[i + minTileZ] = new StencilMode({func: gl.GREATER, mask: 0xFF}, stencilValues + 1 + i, 0xFF, gl.KEEP, gl.KEEP, gl.REPLACE);
                zToStencilModeLow[i + minTileZ] = new StencilMode({func: gl.GREATER, mask: 0xFF}, 1 + i, 0xFF, gl.KEEP, gl.KEEP, gl.REPLACE);
            }
            this.nextStencilID = stencilValues * 2 + 1;
            return [
                zToStencilModeHigh,
                zToStencilModeLow,
                coords
            ];
        } else {
            this.nextStencilID = 3;
            return [
                {[minTileZ]: new StencilMode({func: gl.GREATER, mask: 0xFF}, 2, 0xFF, gl.KEEP, gl.KEEP, gl.REPLACE)},
                {[minTileZ]: new StencilMode({func: gl.GREATER, mask: 0xFF}, 1, 0xFF, gl.KEEP, gl.KEEP, gl.REPLACE)},
                coords
            ];
        }
    }
}

/** Identifies the area a tile's clipping mask covers, the same for every source and overscaled zoom. */
function clippingMaskArea(tileID: OverscaledTileID): string {
    const {z, x, y} = tileID.canonical;
    return `${tileID.wrap}/${z}/${x}/${y}`;
}

function tilesOverlap(a: OverscaledTileID, b: OverscaledTileID): boolean {
    if (a.wrap !== b.wrap) return false;
    const z = Math.min(a.canonical.z, b.canonical.z);
    return a.canonical.x >> (a.canonical.z - z) === b.canonical.x >> (b.canonical.z - z) &&
        a.canonical.y >> (a.canonical.z - z) === b.canonical.y >> (b.canonical.z - z);
}

function hasOverlappingTiles(tileIDs: OverscaledTileID[]): boolean {
    for (let i = 0; i < tileIDs.length; i++) {
        for (let j = i + 1; j < tileIDs.length; j++) {
            if (tilesOverlap(tileIDs[i], tileIDs[j])) return true;
        }
    }
    return false;
}
