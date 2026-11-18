import {describe, expect, test} from 'vitest';
import {createSymbolClip, symbolClipTester} from './symbol_clip.ts';
import {CanonicalTileID} from '../tile/tile_id.ts';
import {EXTENT} from '../data/extent.ts';

// The north-west quarter of tile 1/1/0, with a hole in its middle.
const area: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [
        [[0, 85.0511], [90, 85.0511], [90, 66.5133], [0, 66.5133], [0, 85.0511]],
        [[40, 80], [50, 80], [50, 78], [40, 78], [40, 80]],
    ],
};

describe('symbolClipTester', () => {
    const clip = createSymbolClip(['names'], area);
    const tile = new CanonicalTileID(1, 1, 0);
    const at = (x: number, y: number) => [EXTENT * x, EXTENT * y];

    test('holds the points inside the area and none outside it', () => {
        const clipped = symbolClipTester(clip, ['names'], tile);
        expect(clipped(at(0.125, 0.125))).toBe(true);
        expect(clipped(at(0.75, 0.125))).toBe(false);
        expect(clipped(at(0.125, 0.75))).toBe(false);
    });

    test('leaves a hole in the area unclipped', () => {
        const clipped = symbolClipTester(clip, ['names'], tile);
        expect(clipped(at(0.25, 0.255))).toBe(false);
    });

    test('holds a line only where the whole of it lies in one polygon, as `within` does', () => {
        const clipped = symbolClipTester(clip, ['names'], tile);
        expect(clipped([...at(0.05, 0.05), ...at(0.1, 0.1), ...at(0.15, 0.05)])).toBe(true);
        // One end outside.
        expect(clipped([...at(0.05, 0.05), ...at(0.75, 0.05)])).toBe(false);
        // Both ends inside, across the hole.
        expect(clipped([...at(0.2, 0.255), ...at(0.3, 0.255)])).toBe(false);
    });

    test('does not hold a line that runs from one polygon into the next', () => {
        const halves = createSymbolClip(['names'], {
            type: 'MultiPolygon',
            coordinates: [
                [[[0, 85.0511], [45, 85.0511], [45, 66.5133], [0, 66.5133], [0, 85.0511]]],
                [[[45, 85.0511], [90, 85.0511], [90, 66.5133], [45, 66.5133], [45, 85.0511]]],
            ],
        });
        const clipped = symbolClipTester(halves, ['names'], tile);
        expect(clipped([...at(0.1, 0.1), ...at(0.2, 0.1)])).toBe(true);
        expect(clipped([...at(0.2, 0.1), ...at(0.3, 0.1)])).toBe(false);
    });

    test('is null for a layer it does not name and for a tile it does not reach', () => {
        expect(symbolClipTester(clip, ['places'], tile)).toBeNull();
        expect(symbolClipTester(clip, ['names'], new CanonicalTileID(1, 0, 1))).toBeNull();
    });
});
