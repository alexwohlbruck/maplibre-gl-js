import {describe, expect, test} from 'vitest';
import Point from '@mapbox/point-geometry';
import {EXTENT} from '../extent.ts';
import {anchorElevation, terrainAnchor} from './fill_extrusion_anchor.ts';

const box = (west: number, north: number, east: number, south: number) =>
    [[new Point(west, north), new Point(east, north), new Point(east, south), new Point(west, south), new Point(west, north)]];

describe('terrainAnchor', () => {
    test('anchors a building inside the tile at the centre of its bounds, with its reach in the low bits', () => {
        // Half extents 100 and 20: reaches of 8 * 2^4 = 128 and 8 * 2^2 = 32.
        expect(terrainAnchor(box(900, 480, 1100, 520))).toEqual({x: 1000 + 4, y: 496 + 2});
    });

    test('leaves a building to the tile that holds the centre of its bounds', () => {
        expect(terrainAnchor(box(-300, 100, 100, 200))).toBeNull();
        expect(terrainAnchor(box(EXTENT - 100, 100, EXTENT + 300, 200))).toBeNull();
    });

    test('anchors a piece cut by a tile edge on the edge, where its neighbour anchors too', () => {
        const here = terrainAnchor(box(-100, 1000, 300, 1200));
        // The same building as the tile to the west sees it.
        const there = terrainAnchor(box(EXTENT - 100, 1000, EXTENT + 300, 1200));
        expect(here.x).toBe(0);
        expect(there).toBeNull();
        // Midway along the 200 units the edge cuts, reaching 8 * 2^4 = 128 either way.
        expect(here.y).toBe(1096 + 4);
    });

    test('anchors a piece cut by two edges on their corner', () => {
        expect(terrainAnchor(box(-100, -100, 300, 300))).toEqual({x: 0, y: 0});
    });
});

describe('anchorElevation', () => {
    const slope = (x: number, y: number) => x + 2 * y;

    test('is the ground at the anchor for a building within a grid cell', () => {
        expect(anchorElevation(1000, 496, slope)).toBe(1000 + 2 * 496);
    });

    test('is the lowest ground over the anchor\'s reach', () => {
        // Reaches of 128 and 32 around (1000, 496): lowest at the north-west corner.
        expect(anchorElevation(1004, 498, slope)).toBe(1000 - 128 + 2 * (496 - 32));
    });
});
