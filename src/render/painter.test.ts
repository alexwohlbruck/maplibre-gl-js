import {describe, beforeEach, test, expect, vi, afterEach} from 'vitest';
import {Painter} from './painter.ts';
import {FrameRenderContext} from './frame_render_context.ts';
import {GlobeProjection} from '../geo/projection/globe_projection.ts';
import {Style} from '../style/style.ts';
import {CustomStyleLayer} from '../style/style_layer/custom_style_layer.ts';
import {StubMap, createFrameRenderData, createTestCamera} from '../util/test/util.ts';
import {Texture} from '../webgl/texture.ts';
import {createNullGL} from '../util/test/null_gl.ts';
import {restoreNow, setNow} from '../util/time_control.ts';

import type {ProjectedCamera} from '../camera/projected_camera.ts';
import type {WorldCoordinateHelper} from '../geo/world_types.ts';

describe('render', () => {
    let painter: Painter;
    let map: any;
    let style: Style;
    let projectedCamera: ProjectedCamera;
    let worldCoordinateHelper: WorldCoordinateHelper;
    const renderOptions = createFrameRenderData();

    beforeEach(() => {
        const gl = createNullGL();
        const camera = createTestCamera({minZoom: 0, maxZoom: 22, minPitch: 0, maxPitch: 60, renderWorldCopies: true, width: 512, height: 512});
        projectedCamera = camera.projectedCamera;
        worldCoordinateHelper = camera.context.worldCoordinateHelper;
        painter = new Painter(gl);
        map = new StubMap() as any;
        style = new Style(map);
        style._setProjectionInternal('mercator');
        style._updatePlacement(projectedCamera, worldCoordinateHelper, false, 0, false);
    });

    test('must not fail with incompletely loaded style', () => {
        expect(() => painter.render(style, projectedCamera, worldCoordinateHelper, renderOptions)).not.toThrow();
    });

    test('calls terrainDepth', () => {
        const terrainDepth = vi.spyOn(painter.drawFunctions, 'terrainDepth').mockImplementation(() => {});
        map.terrain = {tileManager: {anyTilesAfterTime: () => false}};

        painter.render(style, projectedCamera, worldCoordinateHelper, renderOptions);

        expect(terrainDepth).toHaveBeenCalled();
    });

    test('redraws cached terrain depth once after deferred invalidations', ({onTestFinished}) => {
        const terrainDepth = vi.spyOn(painter.drawFunctions, 'terrainDepth').mockImplementation(() => {}).mockClear();
        onTestFinished(() => terrainDepth.mockRestore());
        map.terrain = {tileManager: {anyTilesAfterTime: () => false}};

        painter.render(style, projectedCamera, worldCoordinateHelper, renderOptions);
        expect(terrainDepth).toHaveBeenCalledTimes(1);
        painter.render(style, projectedCamera, worldCoordinateHelper, renderOptions);
        expect(terrainDepth).toHaveBeenCalledTimes(1);

        painter.markTerrainDepthDirty();
        painter.markTerrainDepthDirty();
        expect(terrainDepth).toHaveBeenCalledTimes(1);

        painter.render(style, projectedCamera, worldCoordinateHelper, renderOptions);
        expect(terrainDepth).toHaveBeenCalledTimes(2);
        painter.render(style, projectedCamera, worldCoordinateHelper, renderOptions);
        expect(terrainDepth).toHaveBeenCalledTimes(2);
    });

    test('builds frame render context from the projected camera, terrain and frame data', () => {
        const terrain = {tileManager: {anyTilesAfterTime: () => false}};
        map.terrain = terrain;
        style.projection = new GlobeProjection({type: 'vertical-perspective'}, {});
        const terrainDepth = vi.spyOn(painter.drawFunctions, 'terrainDepth').mockImplementation(() => {});
        vi.spyOn(painter.drawFunctions, 'atmosphere').mockImplementation(() => {});

        const data = {...renderOptions, projectionTransition: 1, isRenderingGlobe: true};

        painter.render(style, projectedCamera, worldCoordinateHelper, data);

        const frameRenderContext = terrainDepth.mock.calls[0][2];
        expect(frameRenderContext.projectedCamera).toBe(projectedCamera);
        expect(frameRenderContext.worldCoordinateHelper).toBe(worldCoordinateHelper);
        expect(frameRenderContext.terrain).toBe(terrain);
        expect(frameRenderContext.data).toBe(data);
    });

    /** A style of `count` hidden layers, which the frame counts but draws none of. */
    function withHiddenLayers(count: number) {
        style._order = Array.from({length: count}, (_, i) => `layer-${i}`);
        for (const id of style._order) {
            style._layers[id] = {id, type: 'background', paint: {get: () => 0}, is3D: () => false, isHidden: () => true, hasOffscreenPass: () => false} as any;
        }
    }

    test('3D layers take the whole depth range under terrain, however many layers the style has', ({onTestFinished}) => {
        const setRange = vi.spyOn(FrameRenderContext.prototype, 'setDepthRangeFor3D');
        onTestFinished(() => setRange.mockRestore());
        vi.spyOn(painter.drawFunctions, 'terrainDepth').mockImplementation(() => {});
        map.terrain = {tileManager: {anyTilesAfterTime: () => false}};
        painter.renderToTexture = {prepareForRender: vi.fn(), renderLayer: vi.fn(() => false)} as any;
        vi.spyOn(painter, 'clearRTTPool').mockImplementation(() => {});

        for (const layerCount of [0, 20]) {
            withHiddenLayers(layerCount);
            painter.render(style, projectedCamera, worldCoordinateHelper, renderOptions);
            const frameRenderContext = setRange.mock.contexts.at(-1) as FrameRenderContext;
            expect(frameRenderContext.depthRangeFor3D).toEqual([0, 1]);
        }
    });

    test('3D layers draw beneath every layer\'s sublayers without terrain', ({onTestFinished}) => {
        const setRange = vi.spyOn(FrameRenderContext.prototype, 'setDepthRangeFor3D');
        onTestFinished(() => setRange.mockRestore());

        painter.render(style, projectedCamera, worldCoordinateHelper, renderOptions);
        const few = (setRange.mock.contexts.at(-1) as FrameRenderContext).depthRangeFor3D[1];
        withHiddenLayers(20);
        painter.render(style, projectedCamera, worldCoordinateHelper, renderOptions);
        const many = (setRange.mock.contexts.at(-1) as FrameRenderContext).depthRangeFor3D[1];

        expect(few).toBeLessThan(1);
        expect(many).toBeLessThan(few);
    });

    test('uses frame render context for depth and blending when drawing a custom layer', () => {
        const frameRenderContext = new FrameRenderContext({projectedCamera, worldCoordinateHelper, terrain: null, data: renderOptions, context: painter.context, programCache: painter.programCache, currentPass: 'translucent', projection: style.projection});
        frameRenderContext.depthRangeFor3D = [0.1, 0.8];
        const render = vi.fn((gl: WebGL2RenderingContext) => {
            expect(painter.context.depthRange.get()).toEqual([0.1, 0.8]);
            expect(painter.context.blend.get()).toBe(true);
            expect(painter.context.blendFunc.get()).toEqual([gl.ONE, gl.ONE_MINUS_SRC_ALPHA]);
        });
        const layer = new CustomStyleLayer({id: 'custom', type: 'custom', renderingMode: '3d', render}, {});

        painter.renderLayer(painter, null, layer, [], frameRenderContext);

        expect(render).toHaveBeenCalledTimes(1);
    });

    describe('terrain render time', () => {
        beforeEach(() => {
            vi.spyOn(painter.drawFunctions, 'terrainDepth').mockImplementation(() => {});
            map.terrain = {tileManager: {anyTilesAfterTime: () => false}};
        });

        afterEach(() => {
            restoreNow();
        });

        test('stores terrain render time using the controlled clock', () => {
            setNow(1234);
            painter.render(style, projectedCamera, worldCoordinateHelper, renderOptions);

            expect(painter.terrainFacilitator.renderTime).toBe(1234);
        });
    });
});

describe('tile texture pool', () => {
    function createPainterWithPool() {
        const gl = createNullGL();
        return new Painter(gl);
    }

    function createTexture(painter: Painter, size: number): Texture {
        const gl = painter.context.gl;
        const image = {width: size, height: size, data: new Uint8Array(size * size * 4)} as any;
        return new Texture(painter.context, image, gl.RGBA);
    }

    test('saveTileTexture caps pool size and destroys excess', () => {
        const painter = createPainterWithPool();
        const cap = Painter.MAX_TEXTURE_POOL_SIZE_PER_BUCKET;

        const textures: Texture[] = [];
        for (let i = 0; i < cap + 100; i++) {
            const tex = createTexture(painter, 256);
            textures.push(tex);
            painter.saveTileTexture(tex);
        }

        let reused = 0;
        while (painter.getTileTexture(256)) reused++;
        expect(reused).toBe(cap);

        const destroyed = textures.filter(t => t.texture === null).length;
        expect(destroyed).toBe(100);

        painter.destroy();
    });
});

describe('RTT pool', () => {
    let painter: Painter;

    beforeEach(() => {
        const gl = createNullGL();
        painter = new Painter(gl);
    });

    afterEach(() => {
        painter.destroy();
    });

    test('acquireRTT creates on miss, recycles on hit', () => {
        const a = painter.acquireRTT(256);
        expect(a.size).toBe(256);
        expect(a.texture).toBeTruthy();

        painter.releaseRTT(a);
        expect(painter.acquireRTT(256)).toBe(a);
    });

    test('acquireRTT resizes pooled textures when sizes differ', () => {
        const a = painter.acquireRTT(256);
        const texture = a.texture;
        painter.releaseRTT(a);

        const b = painter.acquireRTT(512);
        expect(b).toBe(a);
        expect(b.size).toBe(512);
        expect(b.texture).toBe(texture);
        expect(b.texture.size).toEqual([512, 512]);
    });

    test('bindRTT lazily creates shared FBO and binds texture', () => {
        expect(painter._rttSharedFbo).toBeNull();
        const obj = painter.acquireRTT(256);
        painter.bindRTT(obj);
        expect(painter._rttSharedFbo).toBeTruthy();
        expect(painter._rttSharedFbo.size).toBe(256);
    });

    test('bindRTT resizes shared depth-stencil when size changes', () => {
        const a = painter.acquireRTT(256);
        painter.bindRTT(a);
        expect(painter._rttSharedFbo.size).toBe(256);

        const b = painter.acquireRTT(512);
        painter.bindRTT(b);
        expect(painter._rttSharedFbo.size).toBe(512);
    });

    test('clearRTTPool destroys the pooled textures and leaves the ones tiles hold', () => {
        const pooled = painter.acquireRTT(256);
        const held = painter.acquireRTT(256);
        vi.spyOn(pooled.texture, 'destroy');
        vi.spyOn(held.texture, 'destroy');
        painter.releaseRTT(pooled);

        painter.clearRTTPool();

        expect(pooled.texture.destroy).toHaveBeenCalledTimes(1);
        expect(held.texture.destroy).not.toHaveBeenCalled();
        expect(painter.acquireRTT(256)).not.toBe(pooled);
    });

    test('destroyRTTResources frees the pool and the shared FBO, and both come back on the next acquire', () => {
        const gl = painter.context.gl;
        const obj = painter.acquireRTT(256);
        vi.spyOn(obj.texture, 'destroy');
        painter.bindRTT(obj);
        painter.releaseRTT(obj);

        painter.destroyRTTResources();

        expect(obj.texture.destroy).toHaveBeenCalledTimes(1);
        expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
        expect(gl.deleteRenderbuffer).toHaveBeenCalledTimes(1);

        painter.bindRTT(painter.acquireRTT(256));
        expect(gl.createFramebuffer).toHaveBeenCalledTimes(2);
    });

    test('painter.destroy cleans up pooled RTT textures and shared FBO', () => {
        const objs = [];
        for (let i = 0; i < 10; i++) {
            const obj = painter.acquireRTT(128);
            vi.spyOn(obj.texture, 'destroy');
            objs.push(obj);
        }
        // Bind one to force shared FBO creation
        painter.bindRTT(objs[0]);
        for (const obj of objs) painter.releaseRTT(obj);

        painter.destroy();
        const destroyed = objs.filter(o => o.texture.destroy.mock.calls.length > 0).length;
        expect(destroyed).toBe(10);
        expect(painter._rttSharedFbo).toBeNull();
    });
});
