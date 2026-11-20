import {describe, expect, test} from 'vitest';
import {terrainRelief, terrainUniformValues} from './terrain_program.ts';
import {Sky, calculateFogBlendOpacity} from '../../style/sky.ts';
import {mat4} from 'gl-matrix';

describe('terrainUniformValues', () => {
    test('disables fog when in globe projection mode', () => {
        const eleDelta = 1.0;
        const fogMatrix = mat4.create();
        const sky = new Sky({}, {}).getEvaluated();
        const pitch = 45;
        const isGlobeMode = true;
        const uniformValues = terrainUniformValues(eleDelta, fogMatrix, sky, pitch, isGlobeMode);

        expect(uniformValues['u_fog_ground_blend_opacity']).toBe(0);
        expect(uniformValues['u_ele_delta']).toBe(eleDelta);
        expect(uniformValues['u_fog_matrix']).toBe(fogMatrix);
        expect(uniformValues['u_fog_color']).toEqual(sky['fog-color']);
        expect(uniformValues['u_fog_ground_blend']).toBe(sky['fog-ground-blend']);
    });

    test('enables fog when not in globe projection mode', () => {
        const eleDelta = 1.0;
        const fogMatrix = mat4.create();
        const sky = new Sky({}, {}).getEvaluated();
        const pitch = 45;
        const isGlobeMode = false;
        const uniformValues = terrainUniformValues(eleDelta, fogMatrix, sky, pitch, isGlobeMode);
        expect(uniformValues['u_fog_ground_blend_opacity']).toBe(calculateFogBlendOpacity(pitch));
    });
});

const light = (position: [number, number, number], anchor: 'map' | 'viewport' = 'map') =>
    ({position, anchor, intensity: 0.5}) as any;

describe('terrainRelief', () => {
    test('shades nothing without a strength or a light', () => {
        expect(terrainRelief(light([1.15, 210, 30]), 0, 0, {z: 10, y: 400}).light[3]).toBe(0);
        expect(terrainRelief(undefined, 0, 1, {z: 10, y: 400}).light[3]).toBe(0);
    });

    test('points a unit light the way the extrusions are lit, and turns a viewport light with the camera', () => {
        const fixed = terrainRelief(light([1.15, 90, 60]), Math.PI / 2, 1, {z: 10, y: 400}).light;
        expect(Math.hypot(fixed[0], fixed[1], fixed[2])).toBeCloseTo(1);
        expect(fixed[2]).toBeCloseTo(0.5);
        const turned = terrainRelief(light([1.15, 90, 60], 'viewport'), Math.PI / 2, 1, {z: 10, y: 400}).light;
        expect(turned[0]).toBeCloseTo(-fixed[1]);
        expect(turned[1]).toBeCloseTo(fixed[0]);
    });

    test('measures a tile unit in metres, narrower toward the poles', () => {
        const equator = terrainRelief(light([1.15, 0, 30]), 0, 1, {z: 0, y: 0}).scale;
        expect(equator[0] * 8192).toBeCloseTo(2 * Math.PI * 6371008.8, -3);
        expect(equator[1]).toBe(0.5);
        expect(terrainRelief(light([1.15, 0, 30]), 0, 1, {z: 2, y: 0}).scale[0]).toBeLessThan(equator[0] / 4);
    });
});
