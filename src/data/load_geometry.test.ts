import {describe, test, expect, beforeAll, vi} from 'vitest';
import Point from '@mapbox/point-geometry';
import {EXTENT} from './extent.ts';
import {loadGeometry} from './load_geometry.ts';
import {loadVectorTile} from '../../test/unit/lib/tile.ts';

import type {VectorTileFeatureLike, VectorTileLayerLike} from '@maplibre/vt-pbf';

describe('loadGeometry', () => {
    let sourceLayer: VectorTileLayerLike;
    beforeAll(() => {
        // Load line features from fixture tile.
        sourceLayer = loadVectorTile().layers.road;
    });

    test('loadGeometry', () => {
        const feature = sourceLayer.feature(0);
        const originalGeometry = feature.loadGeometry();
        const scaledGeometry = loadGeometry(feature);
        expect(scaledGeometry[0][0].x).toBe(originalGeometry[0][0].x * 2);
        expect(scaledGeometry[0][0].y).toBe(originalGeometry[0][0].y * 2);
    });

    const fake = (type: 1 | 2 | 3, ...lines: [number, number][][]) => ({
        extent: EXTENT,
        type,
        loadGeometry: () => lines.map(l => l.map(([x, y]) => new Point(x, y))),
    }) as unknown as VectorTileFeatureLike;
    const coords = (g: Point[][]) => g.map(l => l.map(p => [p.x, p.y]));

    test('a line past the coordinate range is cut at it, not bent', () => {
        const g = loadGeometry(fake(2, [[0, 100], [40000, 100]]));
        expect(coords(g)).toEqual([[[0, 100], [16383, 100]]]);
    });

    test('a line that leaves the range and comes back splits in two', () => {
        const g = loadGeometry(fake(2, [[0, 0], [30000, 0], [30000, 100], [0, 100]]));
        expect(coords(g)).toEqual([[[0, 0], [16383, 0]], [[16383, 100], [0, 100]]]);
    });

    test('a diagonal cut lands on the range edge along the line', () => {
        const g = loadGeometry(fake(2, [[0, 0], [32766, 32766]]));
        expect(coords(g)).toEqual([[[0, 0], [16383, 16383]]]);
    });

    test('a line entirely outside the range is dropped', () => {
        expect(loadGeometry(fake(2, [[20000, 0], [30000, 0]]))).toEqual([]);
    });

    test('a polygon past the range is still clamped, with a warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const g = loadGeometry(fake(3, [[0, 0], [40000, 0], [0, 100], [0, 0]]));
        expect(coords(g)[0][1]).toEqual([16383, 0]);
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });
});
