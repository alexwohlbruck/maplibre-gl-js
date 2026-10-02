import {describe, test, expect} from 'vitest';
import {createStyleLayer} from '../create_style_layer.ts';
import {extend} from '../../util/util.ts';

import type {LineStyleLayer} from './line_style_layer.ts';

describe('LineStyleLayer', () => {
    function createLineLayer(layer?) {
        return extend({
            type: 'line',
            source: 'line',
            id: 'line',
            paint: {
                'line-color': 'red',
                'line-width': 14,
                'line-gradient': [
                    'interpolate',
                    ['linear'],
                    ['line-progress'],
                    0,
                    'blue',
                    1,
                    'red'
                ]
            }
        }, layer);
    }

    test('updating with valid line-gradient updates this.gradientVersion', () => {
        const lineLayer = createStyleLayer(createLineLayer(), {}) as LineStyleLayer;
        const gradientVersion = lineLayer.gradientVersion;

        lineLayer.setPaintProperty('line-gradient', [
            'interpolate',
            ['linear'],
            ['line-progress'],
            0,
            'red',
            1,
            'blue'
        ]);
        expect(lineLayer.gradientVersion).toBeGreaterThan(gradientVersion);
    });

    test('updating with invalid line-gradient updates this.gradientVersion', () => {
        const lineLayer = createStyleLayer(createLineLayer(), {}) as LineStyleLayer;
        const gradientVersion = lineLayer.gradientVersion;

        lineLayer.setPaintProperty('line-gradient', null);
        expect(lineLayer.gradientVersion).toBeGreaterThan(gradientVersion);
    });

    describe('variable line-offset (line-progress)', () => {
        function layerWithOffset(offset?: any): LineStyleLayer {
            const layer = createStyleLayer({
                type: 'line',
                source: 'line',
                id: 'line',
                paint: offset === undefined ? {} : {'line-offset': offset}
            }, {}) as LineStyleLayer;
            return layer;
        }

        test('hasVariableOffset is false for constant / zoom / feature offsets', () => {
            expect(layerWithOffset().hasVariableOffset()).toBe(false);
            expect(layerWithOffset(4).hasVariableOffset()).toBe(false);
            expect(layerWithOffset(['interpolate', ['linear'], ['zoom'], 0, -4, 20, 4]).hasVariableOffset()).toBe(false);
            expect(layerWithOffset(['get', 'off']).hasVariableOffset()).toBe(false);
        });

        test('hasVariableOffset is true when line-offset references line-progress', () => {
            expect(layerWithOffset(['interpolate', ['linear'], ['line-progress'], 0, -10, 1, 10]).hasVariableOffset()).toBe(true);
            expect(layerWithOffset(['step', ['line-progress'], -5, 0.5, 5]).hasVariableOffset()).toBe(true);
        });

        test('offsetExpression evaluates per line-progress', () => {
            const layer = layerWithOffset(['interpolate', ['linear'], ['line-progress'], 0, -10, 1, 10]);
            const expr = layer.offsetExpression();
            expect(expr.evaluate({zoom: 12, lineProgress: 0} as any)).toBe(-10);
            expect(expr.evaluate({zoom: 12, lineProgress: 0.5} as any)).toBe(0);
            expect(expr.evaluate({zoom: 12, lineProgress: 1} as any)).toBe(10);
        });
    });
});
