import {describe, expect, test} from 'vitest';
import {VectorTile, VectorTileLayer} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import {fromVectorTileJs, GeoJSONWrapper} from '@maplibre/vt-pbf';
import {lazyVectorTileLayers} from './lazy_vector_tile.ts';

function tile(): Uint8Array {
    const point = (id: number, tags: Record<string, unknown>) => ({id, type: 1 as const, geometry: [[id, id]], tags});
    const roads = new GeoJSONWrapper([point(1, {name: 'Broadway'}), point(2, {name: 'Canal'})] as any, {extent: 4096, version: 2});
    roads.name = 'roads';
    const trees = new GeoJSONWrapper([point(7, {species: 'oak'})] as any, {extent: 4096, version: 2});
    trees.name = 'trees';
    return fromVectorTileJs({layers: {roads, trees}});
}

describe('lazyVectorTileLayers', () => {
    test('holds the same layers and features as the tile parsed whole', () => {
        const data = tile();
        const whole = new VectorTile(new PbfReader(data)).layers;
        const lazy = lazyVectorTileLayers(data);
        expect(Object.keys(lazy).sort()).toEqual(Object.keys(whole).sort());
        for (const name of Object.keys(whole)) {
            expect(lazy[name]).toHaveLength(whole[name].length);
            for (let i = 0; i < whole[name].length; i++) {
                expect(lazy[name].feature(i).properties).toEqual(whole[name].feature(i).properties);
                expect(lazy[name].feature(i).id).toBe(whole[name].feature(i).id);
                expect(lazy[name].feature(i).loadGeometry()).toEqual(whole[name].feature(i).loadGeometry());
            }
        }
    });

    test('parses a layer once, and only when it is read', () => {
        const lazy = lazyVectorTileLayers(tile());
        expect(Object.getOwnPropertyDescriptor(lazy, 'trees').get).toBeDefined();
        const trees = lazy.trees;
        expect(trees).toBeInstanceOf(VectorTileLayer);
        expect(lazy.trees).toBe(trees);
        expect(lazy.missing).toBeUndefined();
    });
});
