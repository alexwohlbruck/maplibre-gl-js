import {describe, test, expect, vi} from 'vitest';
import {FrameRenderContext} from './frame_render_context.ts';
import {mercatorWorldCoordinateHelper} from '../geo/mercator_coordinate.ts';
import {getCameraMath} from '../camera/camera_math_factory.ts';
import {OverscaledTileID} from '../tile/tile_id.ts';
import {createFrameRenderData, createTestCamera} from '../util/test/util.ts';

import type {Terrain} from './terrain.ts';

describe('getProjectionDataForTile', () => {
    test('selects projection options for regular and terrain-texture draws', () => {
        const tileID = new OverscaledTileID(0, 0, 0, 0, 0);
        const {projectedCamera, context} = createTestCamera({width: 512, height: 512}, {projection: 'globe'});
        const frameRenderContext = new FrameRenderContext({projectedCamera, worldCoordinateHelper: context.worldCoordinateHelper, terrain: null, data: createFrameRenderData(), context: null, programCache: null, currentPass: 'offscreen', projection: null});

        const projectionData = frameRenderContext.getProjectionDataForTile(tileID);
        frameRenderContext.isRenderingToTexture = true;
        const textureProjectionData = frameRenderContext.getProjectionDataForTile(tileID, {aligned: true, applyTerrainMatrix: false});

        expect(projectionData).toEqual({
            ...getCameraMath(projectedCamera).getProjectionData(projectedCamera, {overscaledTileID: tileID, aligned: undefined, applyGlobeMatrix: true, applyTerrainMatrix: true}),
            uniformBufferKey: tileID.key,
        });
        expect(textureProjectionData).toEqual(getCameraMath(projectedCamera).getProjectionData(projectedCamera, {overscaledTileID: tileID, aligned: true, applyGlobeMatrix: false, applyTerrainMatrix: false}));
        expect(textureProjectionData.projectionTransition).not.toBe(projectionData.projectionTransition);
    });
});

describe('getTerrainDataForTile', () => {
    function mockTerrainData() {
        const tileID = new OverscaledTileID(0, 0, 0, 0, 0);
        const terrainData = {tile: null};
        const getTerrainData = vi.fn(() => terrainData);
        const terrain = {getTerrainData} as unknown as Terrain;

        return {tileID, terrainData, getTerrainData, terrain};
    }

    test('uses terrain data for regular Mercator draws', () => {
        const {tileID, terrainData, getTerrainData, terrain} = mockTerrainData();
        const frameRenderContext = new FrameRenderContext({projectedCamera: createTestCamera().projectedCamera, worldCoordinateHelper: mercatorWorldCoordinateHelper, terrain, data: createFrameRenderData(), context: null, programCache: null, currentPass: 'offscreen', projection: null});

        expect(frameRenderContext.getTerrainDataForTile(tileID)).toBe(terrainData);
        expect(getTerrainData).toHaveBeenCalledWith(tileID);
    });

    test('skips terrain data for Mercator render-to-texture draws', () => {
        const {tileID, getTerrainData, terrain} = mockTerrainData();
        const frameRenderContext = new FrameRenderContext({projectedCamera: createTestCamera().projectedCamera, worldCoordinateHelper: mercatorWorldCoordinateHelper, terrain, data: createFrameRenderData(), context: null, programCache: null, currentPass: 'offscreen', projection: null});
        frameRenderContext.isRenderingToTexture = true;

        expect(frameRenderContext.getTerrainDataForTile(tileID)).toBeNull();
        expect(getTerrainData).not.toHaveBeenCalled();
    });

    test('skips terrain data for globe render-to-texture draws', () => {
        const {tileID, getTerrainData, terrain} = mockTerrainData();
        const {projectedCamera, context} = createTestCamera({}, {projection: 'globe'});
        const frameRenderContext = new FrameRenderContext({projectedCamera, worldCoordinateHelper: context.worldCoordinateHelper, terrain, data: {...createFrameRenderData(), projectionTransition: 1, isRenderingGlobe: true}, context: null, programCache: null, currentPass: 'offscreen', projection: null});
        frameRenderContext.isRenderingToTexture = true;

        expect(frameRenderContext.getTerrainDataForTile(tileID)).toBeNull();
        expect(getTerrainData).not.toHaveBeenCalled();
    });
});

describe('tile clipping masks', () => {
    const clipped = (source: string) => ({source, isTileClipped: () => true}) as any;
    const tile = (z: number, x: number, y: number, overscaledZ = z) => new OverscaledTileID(overscaledZ, 0, z, x, y);
    const drawn = (draw: ReturnType<typeof vi.fn>) => draw.mock.calls.map(([, tileIDs]) => tileIDs.map((t: OverscaledTileID) => t.key));

    function setup() {
        const {projectedCamera, context} = createTestCamera({width: 512, height: 512});
        const gl = {ALWAYS: 0, EQUAL: 1, NOTEQUAL: 2, KEEP: 3, REPLACE: 4};
        const glContext = {gl, setColorMode: vi.fn(), setDepthMode: vi.fn(), clear: vi.fn()} as any;
        const frameRenderContext = new FrameRenderContext({projectedCamera, worldCoordinateHelper: context.worldCoordinateHelper, terrain: null, data: createFrameRenderData(), context: glContext, programCache: null, currentPass: 'translucent', projection: null});
        const draw = vi.spyOn(frameRenderContext as any, 'renderTileMasks').mockImplementation(() => {});
        const ref = (tileID: OverscaledTileID) => frameRenderContext.stencilModeForClipping(tileID).ref;
        return {frameRenderContext, draw, ref};
    }

    test('are reused across sources covering the same tiles', () => {
        const {frameRenderContext, draw, ref} = setup();
        const tiles = [tile(16, 1, 2), tile(16, 2, 2)];

        frameRenderContext.renderTileClippingMasks(clipped('basemap'), tiles);
        frameRenderContext.renderTileClippingMasks(clipped('detail'), tiles);

        expect(draw).toHaveBeenCalledTimes(1);
        expect(tiles.map(ref)).toEqual([1, 2]);
    });

    test('are reused for an overscaled tile over the same area', () => {
        const {frameRenderContext, draw, ref} = setup();

        frameRenderContext.renderTileClippingMasks(clipped('detail'), [tile(14, 1, 2)]);
        frameRenderContext.renderTileClippingMasks(clipped('basemap'), [tile(14, 1, 2, 16)]);

        expect(draw).toHaveBeenCalledTimes(1);
        expect(ref(tile(14, 1, 2, 16))).toBe(1);
    });

    test('are drawn only for tiles the stencil lacks', () => {
        const {frameRenderContext, draw, ref} = setup();

        frameRenderContext.renderTileClippingMasks(clipped('basemap'), [tile(16, 1, 2)]);
        frameRenderContext.renderTileClippingMasks(clipped('detail'), [tile(16, 1, 2), tile(16, 2, 2)]);

        expect(drawn(draw)).toEqual([[tile(16, 1, 2).key], [tile(16, 2, 2).key]]);
        expect([ref(tile(16, 1, 2)), ref(tile(16, 2, 2))]).toEqual([1, 2]);
    });

    test('are redrawn once a tile over the same area has overwritten them', () => {
        const {frameRenderContext, draw, ref} = setup();

        frameRenderContext.renderTileClippingMasks(clipped('basemap'), [tile(15, 0, 1)]);
        frameRenderContext.renderTileClippingMasks(clipped('detail'), [tile(16, 1, 2)]);
        frameRenderContext.renderTileClippingMasks(clipped('basemap'), [tile(15, 0, 1)]);

        expect(draw).toHaveBeenCalledTimes(3);
        expect(ref(tile(15, 0, 1))).toBe(3);
    });

    test('are all redrawn when the tiles overlap each other, or after the stencil is invalidated', () => {
        const {frameRenderContext, draw} = setup();

        frameRenderContext.renderTileClippingMasks(clipped('basemap'), [tile(16, 1, 2)]);
        frameRenderContext.renderTileClippingMasks(clipped('detail'), [tile(15, 0, 1), tile(16, 1, 2)]);
        expect(drawn(draw)[1]).toEqual([tile(15, 0, 1).key, tile(16, 1, 2).key]);

        frameRenderContext.invalidateTileClippingMasks();
        frameRenderContext.renderTileClippingMasks(clipped('basemap'), [tile(16, 1, 2)]);
        expect(draw).toHaveBeenCalledTimes(3);
    });
});
