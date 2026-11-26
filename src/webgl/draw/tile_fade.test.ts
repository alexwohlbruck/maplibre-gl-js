import {describe, test, expect} from 'vitest';
import {OverscaledTileID} from '../../tile/tile_id.ts';
import {TileFades, tileFadeDefines} from './tile_fade.ts';

import type {StyleLayer} from '../../style/style_layer.ts';
import type {TileManager} from '../../tile/tile_manager.ts';
import type {Tile} from '../../tile/tile.ts';

const layer = (fade?: unknown) => ({id: 'roads', metadata: fade === undefined ? undefined : {'parchment:tile-fade': fade}}) as unknown as StyleLayer;
const tile = (z: number, x: number, y: number, bucket = true) => ({tileID: new OverscaledTileID(z, 0, z, x, y), hasData: () => true, getBucket: () => (bucket ? {} : undefined)}) as unknown as Tile;
const manager = (...tiles: Tile[]) => ({
    id: 'detail',
    getLoadedTile: (id: OverscaledTileID) => tiles.find(t => t.tileID.key === id.key) ?? null,
    getIds: () => tiles.map(t => t.tileID.key),
    getTileByID: (key: string) => tiles.find(t => t.tileID.key === key),
}) as unknown as TileManager;

describe('tile fades', () => {
    test('a layer fades only with a positive duration', () => {
        expect(tileFadeDefines(layer())).toEqual([]);
        expect(tileFadeDefines(layer('300'))).toEqual([]);
        expect(tileFadeDefines(layer(300))).toEqual(['#define TILE_FADE']);
    });

    test('a tile arriving over nothing fades in over the duration', () => {
        const fades = new TileFades();
        const t = tile(16, 100, 200);
        fades.beginFrame(1000);
        expect(fades.factor(layer(400), manager(t), t)).toBe(0);
        expect(fades.fading).toBe(true);
        fades.beginFrame(1200);
        expect(fades.factor(layer(400), manager(t), t)).toBeCloseTo(0.5);
        fades.beginFrame(1400);
        expect(fades.factor(layer(400), manager(t), t)).toBe(1);
        expect(fades.fading).toBe(false);
    });

    test('a tile taking over from a loaded parent with the layer does not fade', () => {
        const fades = new TileFades();
        const parent = tile(16, 100, 200);
        const child = tile(17, 200, 400);
        fades.beginFrame(0);
        expect(fades.factor(layer(400), manager(parent, child), child)).toBe(1);
    });

    test('a tile taking over from loaded children with the layer does not fade', () => {
        const fades = new TileFades();
        const parent = tile(16, 100, 200);
        const child = tile(17, 201, 401);
        fades.beginFrame(0);
        expect(fades.factor(layer(400), manager(parent, child), parent)).toBe(1);
    });

    test('a parent without the layer still lets the tile fade', () => {
        const fades = new TileFades();
        const parent = tile(15, 50, 100, false);
        const t = tile(16, 100, 200);
        fades.beginFrame(0);
        expect(fades.factor(layer(400), manager(parent, t), t)).toBe(0);
    });

    test('the drape stamp changes each frame while a source tile fades, then rests at 0', () => {
        const fades = new TileFades();
        const t = tile(16, 100, 200);
        fades.beginFrame(0);
        fades.factor(layer(400), manager(t), t);
        fades.beginFrame(100);
        const first = fades.stamp('detail', [t.tileID.key]);
        fades.beginFrame(200);
        const second = fades.stamp('detail', [t.tileID.key]);
        expect(first).not.toBe(0);
        expect(second).not.toBe(first);
        fades.beginFrame(500);
        expect(fades.stamp('detail', [t.tileID.key])).toBe(0);
        expect(fades.stamp('other', [t.tileID.key])).toBe(0);
    });
});
