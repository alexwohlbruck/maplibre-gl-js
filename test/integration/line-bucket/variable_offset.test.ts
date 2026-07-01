import Point from '@mapbox/point-geometry';
import {LineBucket} from '../../../src/data/bucket/line_bucket';
import {LineStyleLayer} from '../../../src/style/style_layer/line_style_layer';
import {EvaluationParameters} from '../../../src/style/evaluation_parameters';
import {shaders} from '../../../src/shaders/shaders';
import type {LayerSpecification} from '@maplibre/maplibre-gl-style-spec';
import type {BucketFeature, BucketParameters} from '../../../src/data/bucket';

function makeLayer(paint: any): LineStyleLayer {
    const layer = new LineStyleLayer({id: 'test', type: 'line', paint} as LayerSpecification);
    layer.recalculate({zoom: 12, zoomHistory: {}} as EvaluationParameters, []);
    return layer;
}

function makeBucket(layer: LineStyleLayer): LineBucket {
    return new LineBucket({layers: [layer], zoom: 12} as BucketParameters<LineStyleLayer>);
}

// A lineMetrics line arrives in the worker with mapbox_clip_start / mapbox_clip_end tags
// (injected by geojson-vt). Those set bucket.lineClips, which is what populates the ext buffer.
function lineMetricsFeature(): BucketFeature {
    return {
        type: 2,
        properties: {mapbox_clip_start: 0, mapbox_clip_end: 1},
    } as unknown as BucketFeature;
}

const geometry = [[
    new Point(0, 0),
    new Point(1000, 0),
    new Point(2000, 0),
]];

describe('lineVariableOffset shader', () => {
    // Regression guard: the shader codegen's static-attribute regex only captures
    // `attribute <type> <name>`. A precision qualifier (e.g. `highp`) makes it register the
    // wrong name, so `a_line_offset` never gets an attribute location and the offset reads 0.
    test('registers a_line_offset as a static attribute', () => {
        const variant = shaders.lineVariableOffset;
        const names = (variant.staticAttributes || []).map((a: string) => a.split(' ').pop());
        expect(names).toContain('a_line_offset');
    });
});

describe('LineBucket variable line-offset', () => {
    test('bucket detects a line-progress-driven line-offset', () => {
        const layer = makeLayer({'line-offset': ['interpolate', ['linear'], ['line-progress'], 0, 0, 0.5, 60, 1, 0]});
        const bucket = makeBucket(layer);
        expect(layer.hasVariableOffset()).toBe(true);
        expect(bucket.variableOffsetExpression).toBeTruthy();
    });

    test('a constant line-offset does not set the bucket expression', () => {
        const layer = makeLayer({'line-offset': 50});
        const bucket = makeBucket(layer);
        expect(layer.hasVariableOffset()).toBe(false);
        expect(bucket.variableOffsetExpression).toBeFalsy();
    });

    test('ext buffer gets non-zero a_line_offset for a lineMetrics feature', () => {
        const layer = makeLayer({'line-offset': ['interpolate', ['linear'], ['line-progress'], 0, 0, 0.5, 60, 1, 0]});
        const bucket = makeBucket(layer);
        bucket.addFeature(lineMetricsFeature(), geometry, 0, undefined, {});

        // ext buffer must be populated (one entry per layout vertex)
        expect(bucket.layoutVertexArray2.length).toBeGreaterThan(0);
        expect(bucket.layoutVertexArray2.length).toBe(bucket.layoutVertexArray.length);

        // read the 3rd float (a_line_offset) of every vertex
        const f32 = bucket.layoutVertexArray2.float32;
        const offsets: number[] = [];
        for (let i = 0; i < bucket.layoutVertexArray2.length; i++) {
            offsets.push(f32[i * 3 + 2]);
        }
        const maxOffset = Math.max(...offsets.map(Math.abs));
        // the middle of the line should bow out towards 60px
        expect(maxOffset).toBeGreaterThan(30);
    });

    test('ext buffer a_line_offset stays 0 for a constant line-offset', () => {
        const layer = makeLayer({'line-offset': 50});
        const bucket = makeBucket(layer);
        bucket.addFeature(lineMetricsFeature(), geometry, 0, undefined, {});

        const f32 = bucket.layoutVertexArray2.float32;
        for (let i = 0; i < bucket.layoutVertexArray2.length; i++) {
            expect(f32[i * 3 + 2]).toBe(0);
        }
    });
});
