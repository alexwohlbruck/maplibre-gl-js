import {describe, expect, test} from 'vitest';
import {multiply, overheadMatrix, perMetreAt, regionQuad, steadyRegion, sunLightMatrix, tileToMercator} from './sun_light.ts';

const apply = (m: ArrayLike<number>, [x, y, z]: number[]) => {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [0, 1, 2].map(r => (m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]) / w);
};

describe('steadyRegion', () => {
    test('covers the asked ground and holds still while the point moves within a cell', () => {
        const half = 3e-5;
        const a = steadyRegion(0.3, 0.4, half);
        expect(a.half).toBeGreaterThanOrEqual(half);
        const cell = a.half / 4.5;
        expect(steadyRegion(a.x + cell * 0.4, a.y - cell * 0.4, half)).toEqual(a);
        for (const [dx, dy] of [[0.49, 0.49], [-0.49, 0.49]]) {
            const [x, y] = [a.x + dx * cell, a.y + dy * cell];
            expect(Math.abs(x - a.x) + half).toBeLessThanOrEqual(a.half);
            expect(Math.abs(y - a.y) + half).toBeLessThanOrEqual(a.half);
        }
    });

    test('moves on once the point leaves its cell', () => {
        const a = steadyRegion(0.3, 0.4, 3e-5);
        expect(steadyRegion(0.3 + a.half, 0.4, 3e-5).x).not.toBe(a.x);
    });
});

describe('sunLightMatrix', () => {
    const region = steadyRegion(0.2945, 0.3759, 4e-5);
    const view = {region, toward: [0.5, -0.5, -1] as [number, number, number], floor: 12, ceiling: 400, size: 2048};

    test('keeps the region\'s ground and what stands on it inside the clip box', () => {
        const {light, perMetre} = sunLightMatrix(view);
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
            for (const height of [-80, 12, 400]) {
                const p = apply(light, [region.x + dx * region.half, region.y + dy * region.half, height * perMetre]);
                for (const c of p) expect(Math.abs(c)).toBeLessThanOrEqual(1 + 1e-9);
            }
        }
    });

    test('puts what is nearer the sun at a smaller depth', () => {
        const {light, perMetre} = sunLightMatrix(view);
        const ground = apply(light, [region.x, region.y, 12 * perMetre]);
        const roof = apply(light, [region.x, region.y, 112 * perMetre]);
        expect(roof[2]).toBeLessThan(ground[2]);
    });

    test('a point and the place its shadow falls share a texel', () => {
        const {light, perMetre} = sunLightMatrix(view);
        const top = apply(light, [region.x, region.y, 100 * perMetre]);
        // 100 m down the light: 50 m east and 50 m south of where it started.
        const shadow = apply(light, [region.x + 50 * perMetre, region.y + 50 * perMetre, 0]);
        expect(shadow[0]).toBeCloseTo(top[0], 9);
        expect(shadow[1]).toBeCloseTo(top[1], 9);
    });
});

test('a tile\'s corner lands where the tile is', () => {
    const m = multiply(overheadMatrix({x: 0.5, y: 0.5, half: 0.5}), tileToMercator(1, 1, 0, 0, perMetreAt(0.5)));
    expect(apply(m, [0, 0, 30])).toEqual([0, -1, 0]);
    expect(apply(m, [8192, 8192, 0])).toEqual([1, 0, 0]);
});

test('the unit square spans the region', () => {
    const region = {x: 0.25, y: 0.75, half: 0.125};
    expect(apply(regionQuad(region), [0, 0, 0])).toEqual([0.125, 0.625, 0]);
    expect(apply(regionQuad(region), [1, 1, 0])).toEqual([0.375, 0.875, 0]);
});
