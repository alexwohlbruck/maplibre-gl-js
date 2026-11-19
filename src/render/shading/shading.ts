import {DepthMode} from '../../webgl/depth_mode.ts';
import {StencilMode} from '../../webgl/stencil_mode.ts';
import {ColorMode} from '../../webgl/color_mode.ts';
import {CullFaceMode} from '../../webgl/cull_face_mode.ts';
import {Color} from '@maplibre/maplibre-gl-style-spec';
import {MercatorCoordinate} from '../../geo/mercator_coordinate.ts';
import Point from '@mapbox/point-geometry';
import {extend} from '../../util/util.ts';
import {
    CLIP_TO_UV, multiply, overheadMatrix, perMetreAt, regionQuad, steadyRegion, sunLightMatrix, tileToMercator,
    type Mat4, type Region,
} from './sun_light.ts';

import type {Painter} from '../painter.ts';
import type {OverscaledTileID} from '../../tile/tile_id.ts';
import type {FillExtrusionBucket} from '../../data/bucket/fill_extrusion_bucket.ts';
import type {FillExtrusionStyleLayer} from '../../style/style_layer/fill_extrusion_style_layer.ts';
import type {ProjectionData} from '../../geo/projection/projection_data.ts';
import type {UniformValues} from '../../webgl/uniform_binding.ts';
import type {ShadedExtrusionUniformsType, ShadingReceiverUniformsType} from '../../webgl/program/shading_program.ts';

/** The texture units the sun's shadow map and the ground occlusion are bound to while receivers draw. */
export const SUN_SHADOW_UNIT = 5;
export const OCCLUSION_UNIT = 6;

/** Texels on a side of the footprints drawn from overhead. */
const OCCLUSION_SIZE = 1024;
/** Metres from the view's centre the ground occlusion reaches at zoom 16; it halves with each zoom. */
const OCCLUSION_REACH = 700;
/** Metres from the view's centre shadows are cast at zoom 16. */
const SUN_REACH = 2500;
/** An occlusion's radius in blur sigmas: where a gaussian's tail meets the eye as `exp(-3 d / radius)` does. */
const RADIUS_IN_SIGMAS = 2.1;

/** What a receiver needs of the sun's shadow map for one frame. */
export type SunFrame = {
    /** Clip ← mercator, for the sun's view. */
    light: Mat4;
    perMetre: number;
    texture: WebGLTexture;
    /** Texels on a side of the map. */
    size: number;
    depthPerMetre: number;
    /** Metres a texel spans across the light, its longer side. */
    texelMetres: number;
    /** How much of the shadow shows, 0 to 1. */
    strength: number;
};

/** What a caster is handed to draw where it meets the ground: clip ← mercator, from overhead. */
export type OcclusionFrame = {matrix: Mat4};

/**
 * Anything besides the extrusions that takes part in the shading, drawing with its own programs: a custom layer's
 * models. Each draw is called mid-pass with the target, depth and colour state already set.
 */
export type ShadingCaster = {
    /** Changes whenever what it casts changes; without one its shadows are redrawn every frame. */
    shadowVersion?: number;
    /** Draw depth into the sun's shadow map. */
    drawSunDepth?(gl: WebGL2RenderingContext, frame: SunFrame): void;
    /** Draw where it stands on the ground, in any colour, for the ground occlusion. */
    drawOcclusion?(gl: WebGL2RenderingContext, frame: OcclusionFrame): void;
    /** This frame's sun shadow map, to be shaded by. */
    receiveSun?(frame: SunFrame): void;
};

/**
 * GLSL that draws on a shaded wall, and the uniforms it declares. `source` defines
 * `vec3 shade_wall(vec3 color, vec3 wall, float seed, float style)`: `wall` is metres along the wall, metres up it
 * and the roof's height; `seed` a 0-1 hash of `fill-extrusion-facade-seed`, `style` its `fill-extrusion-facade-style`.
 */
export type WallShader = {source: string; uniforms?: {[name: string]: number | number[]}};

export type ShadingOptions = Partial<Pick<Shading,
'enabled' | 'minZoom' | 'maxZoom' | 'strength' | 'band' | 'edge' | 'edgeWidth' | 'wallShader' | 'sunShadows' | 'groundOcclusion' |
'visibility' | 'opacity' | 'sunCeiling' | 'heightScale' | 'shadowAlpha' | 'shadowOffset' | 'shadowColor' | 'sunTint' |
'skyTint' | 'wallRise' | 'roofLift' | 'casters' | 'fadeZoom' | 'topDownOpacity' | 'topDownPitch' | 'aoRadiusMin' |
'aoRadiusMax' | 'aoIntensity' | 'shadowMapSize'>>;

type CastTile = {layer: FillExtrusionStyleLayer; coord: OverscaledTileID; bucket: FillExtrusionBucket};

type Key = Array<number | string>;
const sameKey = (a: Key, b: Key | null) => !!b && a.length === b.length && a.every((v, i) => v === b[i]);

const ids = new WeakMap<object, number>();
let nextId = 1;
function idOf(o: object): number {
    let id = ids.get(o);
    if (!id) ids.set(o, (id = nextId++));
    return id;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);

/** A matrix as a tile's projection, for programs that take theirs from the projection block. */
function projectionOf(matrix: ArrayLike<number>): ProjectionData {
    const main = Float32Array.from(matrix);
    return {mainMatrix: main, fallbackMatrix: main, tileMercatorCoords: [0, 0, 1, 1], clippingPlane: [0, 0, 0, 0], projectionTransition: 0, clipAntimeridian: false};
}

/**
 * The map's shading: sunlight on the extrusions that cast (`fill-extrusion-cast-shadows`), the shadows they and the
 * registered casters throw on each other and on the ground, and the occlusion where a wall meets it.
 *
 * Shadows come from one depth map drawn from the sun, and occlusion from the footprints drawn from overhead and
 * blurred. Both cover a square of ground that holds still while the camera moves over it, so a frame that only
 * moves the camera draws neither again.
 *
 * Every lever is a field read each frame; set one and repaint.
 */
export class Shading {
    painter: Painter;

    enabled = true;
    /** The zooms the ground effects arrive over, and the occlusion's radius runs between. */
    minZoom = 14;
    maxZoom = 20;
    /** How dark the foot of a wall is, and the share of the wall the darkening reaches up. */
    strength = 0.5;
    band = 1;
    /** The roofline edge: how dark, and how many device pixels wide. */
    edge = 0;
    edgeWidth = 1.5;
    wallShader: WallShader | null = null;
    sunShadows = true;
    groundOcclusion = true;
    /** How much of the shadows and occlusion shows at a pitch, 0 to 1. */
    visibility: number | ((pitch: number) => number) = 1;
    /** Below 1 the ground effects thin with the extrusions over them. */
    opacity = 1;
    /** The tallest caster, metres. */
    sunCeiling = 400;
    /** A shadow's length as a multiple of its caster's height. */
    heightScale = 0.38;
    shadowAlpha = 0.35;
    /** The ground-plane direction a shadow falls, +x east and +y north. */
    shadowOffset: [number, number] = [-0.5, 0.5];
    shadowColor: [number, number, number] = [0, 0, 0];
    sunTint: [number, number, number] = [1, 1, 1];
    skyTint: [number, number, number] = [1, 1, 1];
    /** How much lighter a wall is at its top than its foot, and a roof than the walls. */
    wallRise = 0;
    roofLift = 0;
    casters: Set<ShadingCaster> = new Set();
    /** Zoom levels past `minZoom` the ground effects ramp in over. */
    fadeZoom = 1.2;
    /** What the occlusion drops to looking straight down, reached below `topDownPitch`. */
    topDownOpacity = 0.5;
    topDownPitch = 25;
    /** The occlusion's radius in device pixels at `minZoom` and `maxZoom`, and its strength. */
    aoRadiusMin = 30;
    aoRadiusMax = 120;
    aoIntensity = 0.8;
    shadowMapSize = 2048;

    /** This frame's sun shadow map, or null with no sun. */
    frame: SunFrame | null = null;
    /** Whether cast extrusions are shaded this frame. */
    active = false;
    /** The layer the flat ground's shading is drawn beneath. */
    groundLayer: string | null = null;
    /** How many times each map has been drawn: a camera move alone should add to neither. */
    drawn: {sun: number; occlusion: number} = {sun: 0, occlusion: 0};

    private fade = 0;
    private sunRegion: Region | null = null;
    private sunTexture: WebGLTexture | null = null;
    private sunFramebuffer: WebGLFramebuffer | null = null;
    private sunSize = 0;
    private sunKey: Key | null = null;
    private emptySun: WebGLTexture | null = null;
    private occlusion: {region: Region; uv: Mat4; radius: number} | null = null;
    private occlusionKey: Key | null = null;
    private coverage: {texture: WebGLTexture; framebuffer: WebGLFramebuffer} | null = null;
    private blurred: Array<{texture: WebGLTexture; framebuffer: WebGLFramebuffer; size: number}> = [];
    private empty: WebGLTexture | null = null;
    private wallUniforms = new WeakMap<WebGLProgram, {[name: string]: WebGLUniformLocation | null}>();

    constructor(painter: Painter, options: ShadingOptions = {}) {
        this.painter = painter;
        extend(this, options);
    }

    /** How strongly the ground effects draw: they ramp in over `fadeZoom` levels as the extrusions grow. */
    groundOpacity(): number {
        return smooth(clamp01((this.painter.transform.zoom - this.minZoom) / Math.max(this.fadeZoom, 0.001)));
    }

    private occlusionPitchFade(): number {
        return this.topDownOpacity + (1 - this.topDownOpacity) * smooth(clamp01(this.painter.transform.pitch / Math.max(this.topDownPitch, 0.001)));
    }

    /** The occlusion's radius on the ground, metres, at a zoom and a mercator y. */
    private occlusionRadius(zoom: number, y: number): number {
        const tr = this.painter.transform;
        const t = clamp01((zoom - this.minZoom) / (this.maxZoom - this.minZoom));
        const pixels = Math.min(this.aoRadiusMin + t * (this.aoRadiusMax - this.aoRadiusMin), 0.2 * Math.max(tr.width, tr.height) * this.painter.pixelRatio);
        return pixels / (tr.tileSize * 2 ** zoom * perMetreAt(y) * this.painter.pixelRatio);
    }

    /** The layers that cast this frame, bottom first. */
    private castLayers(): FillExtrusionStyleLayer[] {
        const style = this.painter.style;
        const zoom = this.painter.transform.zoom;
        const layers: FillExtrusionStyleLayer[] = [];
        for (const id of style._order) {
            const layer = style._layers[id];
            if (layer.type !== 'fill-extrusion' || layer.muted || layer.isHidden(zoom)) continue;
            if ((layer as FillExtrusionStyleLayer).paint.get('fill-extrusion-cast-shadows')) layers.push(layer as FillExtrusionStyleLayer);
        }
        return layers;
    }

    /** Whether a layer is drawn shaded this frame. */
    shades(layer: FillExtrusionStyleLayer): boolean {
        return this.active && !!layer.paint.get('fill-extrusion-cast-shadows');
    }

    /**
     * Ready the frame: draw the sun's shadow map and the ground occlusion again if what they show has changed.
     * Called before anything is drawn to the screen.
     */
    prepare(): void {
        const painter = this.painter;
        const tr = painter.transform;
        this.frame = null;
        this.occlusion = null;
        this.groundLayer = null;
        this.active = this.enabled && tr.zoom >= this.minZoom;
        if (!this.active) return;
        const layers = this.castLayers();
        this.groundLayer = layers[0]?.id ?? null;
        const visibility = this.visibility;
        this.fade = typeof visibility === 'function' ? visibility(tr.pitch) : visibility;
        if (this.fade <= 0) return;

        const tiles: CastTile[] = [];
        for (const layer of layers) {
            if (layer.paint.get('fill-extrusion-opacity') === 0) continue;
            const manager = painter.style.tileManagers[layer.source];
            if (!manager) continue;
            for (const coord of manager.getVisibleCoordinates()) {
                const bucket = manager.getTile(coord)?.getBucket(layer) as FillExtrusionBucket;
                if (bucket?.layoutVertexBuffer) tiles.push({layer, coord, bucket});
            }
        }
        if (!tiles.length && !this.casters.size) return;

        const drew = [
            this.groundOcclusion && this.aoIntensity > 0 && this.updateOcclusion(tiles),
            this.sunShadows && this.shadowAlpha > 0.001 && this.updateSun(tiles),
        ].some(Boolean);
        if (drew) {
            const context = painter.context;
            context.setDirty();
            context.bindFramebuffer.set(null);
            context.viewport.set([0, 0, painter.width, painter.height]);
        }
        if (this.frame) for (const caster of this.casters) caster.receiveSun?.(this.frame);
    }

    /** What of a tile's extrusions the passes read, for telling whether they have changed. */
    private castKey(tiles: CastTile[], key: Key): void {
        const zoom = this.painter.transform.zoom;
        for (const {layer, coord, bucket} of tiles) {
            const binders = bucket.programConfigurations.get(layer.id).binders;
            // A height that still depends on the zoom is drawn again as the zoom moves through its tile's level.
            const grows = ['fill-extrusion-height', 'fill-extrusion-base'].some(p => typeof (binders[p] as {zoom?: number})?.zoom === 'number');
            key.push(idOf(bucket), coord.key, bucket.paintRevision, bucket.anchorElevationKey ?? '', grows ? clamp01(zoom - coord.overscaledZ) : 0);
        }
        for (const caster of this.casters) key.push(caster.shadowVersion ?? NaN);
    }

    private drawCast(tiles: CastTile[], depthMode: Readonly<DepthMode>, colorMode: Readonly<ColorMode>, tileMatrix: (coord: OverscaledTileID) => ArrayLike<number>): void {
        const painter = this.painter;
        const context = painter.context;
        const terrain = painter.style.map.terrain;
        for (const {layer, coord, bucket} of tiles) {
            const configuration = bucket.programConfigurations.get(layer.id);
            const program = painter.useProgram('fillExtrusionDepth', configuration, true);
            program.draw(context, context.gl.TRIANGLES, depthMode, StencilMode.disabled, colorMode, CullFaceMode.disabled,
                null, null, projectionOf(tileMatrix(coord)), `${layer.id}/cast`, bucket.layoutVertexBuffer, bucket.indexBuffer,
                bucket.segments, layer.paint, painter.transform.zoom, configuration, terrain?.getAnchorElevations(bucket, coord));
        }
        // Casters draw with their own programs, in the state the extrusions were drawn in.
        context.setDepthMode(depthMode);
        context.setStencilMode(StencilMode.disabled);
        context.setColorMode(colorMode);
        context.setCullFace(CullFaceMode.disabled);
    }

    private sunView(): {region: Region; floor: number} {
        const painter = this.painter;
        const tr = painter.transform;
        const centre = MercatorCoordinate.fromLngLat(tr.center);
        const perMetre = perMetreAt(centre.y);
        // The ground in sight: the view's corners, pulled in to the reach shadows are worth casting over.
        const reach = SUN_REACH * 2 ** (16 - tr.zoom) * perMetre;
        let [minX, minY, maxX, maxY] = [0, 0, 0, 0];
        for (const [x, y] of [[0, 0], [tr.width, 0], [tr.width, tr.height], [0, tr.height]]) {
            const corner = MercatorCoordinate.fromLngLat(tr.screenPointToLocation(new Point(x, y)));
            let [dx, dy] = [corner.x - centre.x, corner.y - centre.y];
            const d = Math.hypot(dx, dy);
            if (d > reach) [dx, dy] = [dx * reach / d, dy * reach / d];
            [minX, minY, maxX, maxY] = [Math.min(minX, dx), Math.min(minY, dy), Math.max(maxX, dx), Math.max(maxY, dy)];
        }
        const half = Math.max(maxX - minX, maxY - minY) / 2;
        const region = steadyRegion(centre.x + (minX + maxX) / 2, centre.y + (minY + maxY) / 2, Math.max(half, 1e-9));
        const terrain = painter.style.map.terrain;
        const ground = terrain ? terrain.getElevationForLngLat(tr.center, tr) : 0;
        return {region, floor: Math.round(ground / 25) * 25};
    }

    /** Ready the sun's shadow map; whether it was drawn again. */
    private updateSun(tiles: CastTile[]): boolean {
        const painter = this.painter;
        const context = painter.context;
        const gl = context.gl;
        const size = this.shadowMapSize;
        const {region, floor} = this.sunView();
        const scale = this.heightScale;
        const toward: [number, number, number] = [this.shadowOffset[0] * scale, this.shadowOffset[1] * scale, -1];
        const {light, perMetre, depthPerMetre, texelMetres} = sunLightMatrix({region, toward, floor, ceiling: this.sunCeiling, size});
        this.sunTarget(size);
        this.sunRegion = region;
        const frame = this.frame = {light, perMetre, texture: this.sunTexture, size, depthPerMetre, texelMetres, strength: this.fade};

        const key: Key = [size, ...light];
        this.castKey(tiles, key);
        if (sameKey(key, this.sunKey)) return false;
        this.sunKey = key;
        this.drawn.sun++;

        context.bindFramebuffer.set(this.sunFramebuffer);
        context.viewport.set([0, 0, size, size]);
        context.clear({depth: 1});
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1.5, 2);
        const depthMode = new DepthMode(gl.LESS, DepthMode.ReadWrite, [0, 1]);
        this.drawCast(tiles, depthMode, ColorMode.disabled, ({canonical: {z, x, y}, wrap}) => multiply(light, tileToMercator(z, x, y, wrap, perMetre)));
        for (const caster of this.casters) caster.drawSunDepth?.(gl, frame);
        gl.polygonOffset(0, 0);
        gl.disable(gl.POLYGON_OFFSET_FILL);
        return true;
    }

    private sunTarget(size: number): void {
        const gl = this.painter.context.gl;
        if (this.sunTexture && this.sunSize === size) return;
        if (this.sunTexture) gl.deleteTexture(this.sunTexture);
        this.sunTexture = this.depthTexture(size);
        this.sunSize = size;
        this.sunKey = null;
        this.sunFramebuffer ??= gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.sunFramebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.sunTexture, 0);
        this.painter.context.bindFramebuffer.dirty = true;
    }

    /** A depth texture a shadow sampler compares against. */
    private depthTexture(size: number): WebGLTexture {
        const gl = this.painter.context.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
        for (const [name, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
            [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
            [gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE], [gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL]]) {
            gl.texParameteri(gl.TEXTURE_2D, name, value);
        }
        return texture;
    }

    private clearTexture(): WebGLTexture {
        const gl = this.painter.context.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        return texture;
    }

    private colorTarget(size: number, mipmapped: boolean): {texture: WebGLTexture; framebuffer: WebGLFramebuffer; size: number} {
        const gl = this.painter.context.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texStorage2D(gl.TEXTURE_2D, mipmapped ? Math.log2(size) + 1 : 1, gl.RGBA8, size, size);
        for (const [name, value] of [[gl.TEXTURE_MIN_FILTER, mipmapped ? gl.LINEAR_MIPMAP_NEAREST : gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
            [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) {
            gl.texParameteri(gl.TEXTURE_2D, name, value);
        }
        const framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        this.painter.context.bindFramebuffer.dirty = true;
        return {texture, framebuffer, size};
    }

    /** Ready the ground occlusion: the cast footprints from overhead, blurred to its radius. Whether it was drawn again. */
    private updateOcclusion(tiles: CastTile[]): boolean {
        const painter = this.painter;
        const context = painter.context;
        const gl = context.gl;
        const tr = painter.transform;
        // Held for half a zoom: the radius is baked at its widest there and narrowed as it is read.
        const zoom = Math.floor(tr.zoom * 2) / 2;
        const centre = MercatorCoordinate.fromLngLat(tr.center);
        const region = steadyRegion(centre.x, centre.y, OCCLUSION_REACH * 2 ** (16 - zoom) * perMetreAt(centre.y));
        const radius = this.occlusionRadius(zoom, region.y);
        const overhead = overheadMatrix(region);
        this.occlusion = {region, uv: multiply(CLIP_TO_UV, overhead), radius};

        const sigma = radius / RADIUS_IN_SIGMAS * perMetreAt(region.y) / (region.half * 2) * OCCLUSION_SIZE;
        const key: Key = [region.x, region.y, region.half, sigma];
        this.castKey(tiles, key);
        if (sameKey(key, this.occlusionKey)) return false;
        this.occlusionKey = key;
        this.drawn.occlusion++;

        this.coverage ??= this.colorTarget(OCCLUSION_SIZE, true);
        context.bindFramebuffer.set(this.coverage.framebuffer);
        context.viewport.set([0, 0, OCCLUSION_SIZE, OCCLUSION_SIZE]);
        context.clear({color: Color.transparent});
        this.drawCast(tiles, DepthMode.disabled, ColorMode.unblended, ({canonical: {z, x, y}, wrap}) => multiply(overhead, tileToMercator(z, x, y, wrap, 0)));
        for (const caster of this.casters) caster.drawOcclusion?.(gl, {matrix: overhead});
        context.setDirty();
        gl.bindTexture(gl.TEXTURE_2D, this.coverage.texture);
        gl.generateMipmap(gl.TEXTURE_2D);

        // Blurred where the sigma is two to four texels: a mip level of the footprints, then one pass each way.
        const level = Math.min(Math.max(Math.floor(Math.log2(sigma / 2)), 0), 4);
        const size = OCCLUSION_SIZE >> level;
        for (let i = 0; i < 2; i++) {
            if (this.blurred[i]?.size === size) continue;
            if (this.blurred[i]) {
                gl.deleteTexture(this.blurred[i].texture);
                gl.deleteFramebuffer(this.blurred[i].framebuffer);
            }
            this.blurred[i] = this.colorTarget(size, false);
        }
        const program = painter.useProgram('shadingBlur', null, true);
        const pass = (from: WebGLTexture, lod: number, to: number, step: [number, number]) => {
            context.bindFramebuffer.set(this.blurred[to].framebuffer);
            context.viewport.set([0, 0, size, size]);
            context.activeTexture.set(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, from);
            program.draw(context, gl.TRIANGLES, DepthMode.disabled, StencilMode.disabled, ColorMode.unblended, CullFaceMode.disabled,
                {'u_image': 0, 'u_step': step, 'u_blur': [sigma / 2 ** level / 1.5, lod]}, null, null, 'shadingBlur',
                painter.viewportBuffer, painter.quadTriangleIndexBuffer, painter.viewportSegments);
        };
        pass(this.coverage.texture, level, 1, [1.5 / size, 0]);
        pass(this.blurred[1].texture, 0, 0, [0, 1.5 / size]);
        return true;
    }

    /** A matrix from a tile's units into the sun's clip space; identity with no sun. */
    sunMatrix(coord: OverscaledTileID): Float32Array {
        const frame = this.frame;
        if (!frame) return IDENTITY;
        const {z, x, y} = coord.canonical;
        return Float32Array.from(multiply(frame.light, tileToMercator(z, x, y, coord.wrap, frame.perMetre)));
    }

    /** A matrix from a tile's units into the ground occlusion's texture. */
    occlusionMatrix(coord: OverscaledTileID): Float32Array {
        if (!this.occlusion) return IDENTITY;
        const {z, x, y} = coord.canonical;
        return Float32Array.from(multiply(this.occlusion.uv, tileToMercator(z, x, y, coord.wrap, 0)));
    }

    /** Whether anything is laid on the ground this frame. */
    shadesGround(): boolean {
        return this.active && (!!this.frame || !!this.occlusion);
    }

    /** Bind the maps for a receiver, and give the uniforms that read them. */
    receive(): UniformValues<ShadingReceiverUniformsType> {
        const context = this.painter.context;
        const gl = context.gl;
        const frame = this.frame;
        const occlusion = this.occlusion;
        // A shadow sampler must never be left on a colour texture, nor a colour sampler on a depth one.
        context.activeTexture.set(gl.TEXTURE0 + SUN_SHADOW_UNIT);
        gl.bindTexture(gl.TEXTURE_2D, frame ? frame.texture : (this.emptySun ??= this.depthTexture(1)));
        context.activeTexture.set(gl.TEXTURE0 + OCCLUSION_UNIT);
        gl.bindTexture(gl.TEXTURE_2D, occlusion ? this.blurred[0].texture : (this.empty ??= this.clearTexture()));
        context.activeTexture.set(gl.TEXTURE0);
        const ground = this.groundOpacity() * this.opacity;
        // Baked at the widest radius of its half zoom; the power narrows it to this zoom's.
        const narrow = occlusion ? (occlusion.radius / this.occlusionRadius(this.painter.transform.zoom, occlusion.region.y)) ** 2 : 1;
        return {
            'u_sun_shadow': SUN_SHADOW_UNIT,
            'u_sun': [frame ? frame.strength : 0, frame ? 1 / frame.size : 0, frame ? frame.depthPerMetre : 0],
            'u_occlusion': OCCLUSION_UNIT,
            'u_occlusion_strength': [occlusion ? this.aoIntensity * ground * this.fade * this.occlusionPitchFade() : 0, Math.max(narrow, 1)],
            'u_ground': [this.heightScale * Math.hypot(this.shadowOffset[0], this.shadowOffset[1]), this.shadowAlpha * ground],
            'u_shadow_color': this.shadowColor,
        };
    }

    /** Lay the shadows and occlusion on flat ground: one quad over all they reach. Terrain is shaded as it is drawn. */
    drawGround(): void {
        if (!this.shadesGround()) return;
        const painter = this.painter;
        const context = painter.context;
        const gl = context.gl;
        const region = this.frame ? this.sunRegion : this.occlusion.region;
        const quad = regionQuad(region);
        const camera = painter.transform.getProjectionDataForCustomLayer(false).mainMatrix;
        const program = painter.useProgram('shadingGround', null, true, ['#define SHADING']);
        program.draw(context, gl.TRIANGLES, DepthMode.disabled, StencilMode.disabled, ColorMode.alphaBlended, CullFaceMode.disabled, {
            ...this.receive(),
            'u_matrix': Float32Array.from(multiply(camera, quad)),
            'u_sun_matrix': this.frame ? Float32Array.from(multiply(this.frame.light, quad)) : IDENTITY,
            'u_occlusion_matrix': this.occlusion ? Float32Array.from(multiply(this.occlusion.uv, quad)) : IDENTITY,
        }, null, null, 'shadingGround', painter.viewportBuffer, painter.quadTriangleIndexBuffer, painter.viewportSegments);
    }

    /** A shaded extrusion's light and where its tile lies: the sun's view, and the fixed grid its walls are measured on. */
    extrusionUniforms(coord: OverscaledTileID): UniformValues<ShadedExtrusionUniformsType> {
        const {z, x, y} = coord.canonical;
        const within = 2 ** Math.max(0, z - 14);
        const row = Math.floor(y / within);
        const tileMetres = 1 / (perMetreAt((row + 0.5) / 2 ** Math.min(z, 14)) * 2 ** Math.min(z, 14));
        return {
            ...this.receive(),
            'u_sun_matrix': this.sunMatrix(coord),
            'u_shade_strength': this.strength,
            'u_shade_band': Math.max(0.01, this.band),
            'u_shade_edge': this.edge,
            'u_shade_edge_width': this.edgeWidth,
            'u_sun_tint': this.sunTint,
            'u_sky_tint': this.skyTint,
            'u_wall_rise': this.wallRise,
            'u_roof_lift': this.roofLift,
            'u_unit_metres': tileMetres / 8192 / within,
            'u_wall_origin': [(x % within) * 8192, (y % within) * 8192],
        };
    }

    /** The wall shader as a block of fragment source, for the program that draws shaded extrusions. */
    wallSource(): string | null {
        return this.wallShader ? `#define SHADING_WALL\n${this.wallShader.source}` : null;
    }

    /** Set the wall shader's own uniforms on a program in use. */
    setWallUniforms(program: WebGLProgram): void {
        const values = this.wallShader?.uniforms;
        if (!values) return;
        const gl = this.painter.context.gl;
        let locations = this.wallUniforms.get(program);
        if (!locations) this.wallUniforms.set(program, (locations = {}));
        for (const name in values) {
            if (!(name in locations)) locations[name] = gl.getUniformLocation(program, name);
            const location = locations[name];
            const value = values[name];
            if (!location) continue;
            if (typeof value === 'number') gl.uniform1f(location, value);
            else if (value.length === 2) gl.uniform2fv(location, value);
            else if (value.length === 3) gl.uniform3fv(location, value);
            else gl.uniform4fv(location, value);
        }
    }

    destroy(): void {
        const gl = this.painter.context.gl;
        for (const texture of [this.sunTexture, this.emptySun, this.empty, this.coverage?.texture, ...this.blurred.map(b => b.texture)]) {
            if (texture) gl.deleteTexture(texture);
        }
        for (const framebuffer of [this.sunFramebuffer, this.coverage?.framebuffer, ...this.blurred.map(b => b.framebuffer)]) {
            if (framebuffer) gl.deleteFramebuffer(framebuffer);
        }
        this.sunTexture = this.sunFramebuffer = this.emptySun = this.empty = this.coverage = null;
        this.blurred = [];
        this.frame = this.occlusion = this.sunKey = this.occlusionKey = null;
        this.active = false;
    }
}

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
