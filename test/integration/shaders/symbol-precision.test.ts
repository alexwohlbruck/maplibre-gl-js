import {describe, expect, test} from 'vitest';
import sdfVertex from '../../../src/shaders/glsl/symbol_sdf.vertex.glsl.g.ts';
import sdfFragment from '../../../src/shaders/glsl/symbol_sdf.fragment.glsl.g.ts';
import textIconVertex from '../../../src/shaders/glsl/symbol_text_and_icon.vertex.glsl.g.ts';
import textIconFragment from '../../../src/shaders/glsl/symbol_text_and_icon.fragment.glsl.g.ts';

describe.each([
    ['SDF symbols', sdfVertex, sdfFragment],
    ['text and icon symbols', textIconVertex, textIconFragment]
])('%s with a distant camera', (_name, vertex, fragment) => {
    test('keeps the camera distance at high precision across shader stages', () => {
        expect(vertex).toContain('out highp vec3 v_data1;');
        expect(fragment).toContain('in highp vec3 v_data1;');
        expect(fragment).toContain('highp float gamma_scale=v_data1.x;');
    });

    test('keeps the reciprocal distance for halos at high precision', () => {
        expect(fragment).toContain('highp float gamma_halo=');
    });
});
