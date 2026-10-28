import {describe, test, expect} from 'vitest';
import Point from '@mapbox/point-geometry';
import {elevateLine, parseElevationProfile, type ElevationRun} from './line_elevation.ts';
import {LineBucket} from './line_bucket.ts';
import {LineStyleLayer} from '../../style/style_layer/line_style_layer.ts';
import {CanonicalTileID} from '../../tile/tile_id.ts';
import {SubdivisionGranularitySetting} from '../../render/subdivision_granularity_settings.ts';
import {EXTENT} from '../extent.ts';

import type {LayerSpecification} from '@maplibre/maplibre-gl-style-spec';
import type {EvaluationParameters} from '../../style/evaluation_parameters.ts';
import type {ZoomHistory} from '../../style/zoom_history.ts';
import type {BucketFeature, BucketParameters} from '../bucket.ts';

const world = new CanonicalTileID(0, 0, 0);

function run(points: Array<[number, number]>, heights: number[], relative = false): ElevationRun {
    return {points: points.map(([x, y]) => new Point(x, y)), heights, relative};
}

describe('parseElevationProfile', () => {
    test('decodes delta-encoded runs into tile units and metres', () => {
        const [a, b] = parseElevationProfile('0,0,25,900000000,0,-40;-900000000,0,0,0,0,0', world);
        expect(a.points[0].x).toBeCloseTo(EXTENT / 2);
        expect(a.points[0].y).toBeCloseTo(EXTENT / 2);
        expect(a.points[1].x).toBeCloseTo(EXTENT * 0.75);
        expect(a.heights).toEqual([2.5, -4]);
        expect(b.points[0].x).toBeCloseTo(EXTENT / 4);
        expect([a.relative, b.relative]).toEqual([false, false]);
    });

    test('reads a run prefixed with ~ as heights over the terrain', () => {
        const [run] = parseElevationProfile('~0,0,-90,1000,0,-90', world);
        expect(run.relative).toBe(true);
        expect(run.heights).toEqual([-9, -9]);
    });

    test('skips malformed runs', () => {
        expect(parseElevationProfile('', world)).toEqual([]);
        expect(parseElevationProfile('1,2,3', world)).toEqual([]);
        expect(parseElevationProfile('1,2,3,4,x,6', world)).toEqual([]);
    });
});

describe('elevateLine', () => {
    const line = [new Point(0, 0), new Point(1000, 0), new Point(2000, 0)];

    test('adds the run as vertices and interpolates between them', () => {
        const {vertices, heights, ground} = elevateLine(line, [run([[200, 2], [600, 0], [1400, 0], [1800, 1]], [4, 30, 30, 4])]);
        expect(vertices.map(p => p.x)).toEqual([0, 200, 600, 1000, 1400, 1800, 2000]);
        expect(heights).toEqual([0, 4, 30, 30, 30, 4, 0]);
        expect(ground).toEqual([1, 0, 0, 0, 0, 0, 1]);
    });

    test('leaves the line on the ground outside its runs and off-line points out', () => {
        const {vertices, heights} = elevateLine(line, [run([[500, 0], [1500, 500]], [-8, -8])]);
        expect(vertices.map(p => p.x)).toEqual([0, 500, 1000, 2000]);
        expect(heights).toEqual([0, -8, 0, 0]);
    });

    test('a point on a vertex takes it over rather than doubling it', () => {
        const {vertices, heights} = elevateLine(line, [run([[0, 0], [1000, 0], [2000, 0]], [0, 6, 0])]);
        expect(vertices).toHaveLength(3);
        expect(heights).toEqual([0, 6, 0]);
    });

    test('does not interpolate across two runs', () => {
        const {heights, ground} = elevateLine(line, [run([[100, 0], [400, 0]], [4, 4]), run([[1600, 0], [1900, 0]], [-6, -6], true)]);
        expect(heights).toEqual([0, 4, 4, 0, -6, -6, 0]);
        expect(ground).toEqual([1, 0, 0, 1, 1, 1, 1]);
    });
});

describe('LineBucket elevation', () => {
    function bucketFor(layout: Record<string, unknown>) {
        const layer = new LineStyleLayer({id: 'l', type: 'line', layout} as LayerSpecification, {});
        layer.recalculate({zoom: 0, zoomHistory: {} as ZoomHistory} as EvaluationParameters, []);
        return new LineBucket({layers: [layer], zoom: 0} as BucketParameters<LineStyleLayer>);
    }

    test('packs each vertex height for a layer with a profile', () => {
        const bucket = bucketFor({'line-elevation-profile': ['get', 'z']});
        expect(bucket.elevated).toBe(true);
        expect(bucket.layers[0].isElevated()).toBe(true);
        const feature = {type: 2, properties: {z: '0,0,30,450000000,0,30'}} as unknown as BucketFeature;
        const geometry = [[new Point(EXTENT / 2, EXTENT / 2), new Point(EXTENT, EXTENT / 2)]];
        bucket.addFeature(feature, geometry, 0, world, {}, {}, SubdivisionGranularitySetting.noSubdivision);
        const heights = new Set<number>();
        const stride = bucket.layoutVertexArray2.bytesPerElement / 4;
        for (let i = 0; i < bucket.layoutVertexArray2.length; i++) heights.add(bucket.layoutVertexArray2.float32[i * stride + 3]);
        // Every vertex runs east, as the line does.
        expect(bucket.layoutVertexArray2.float32[5]).toBeCloseTo(1);
        expect(bucket.layoutVertexArray2.float32[6]).toBeCloseTo(0);
        expect(bucket.layoutVertexArray2.length).toBe(bucket.layoutVertexArray.length);
        expect([...heights].sort()).toEqual([0, 3]);
    });

    test('leaves other layers flat and draped', () => {
        const bucket = bucketFor({});
        expect(bucket.elevated).toBe(false);
        expect(bucket.layers[0].isElevated()).toBe(false);
        bucket.addFeature({type: 2, properties: {}} as unknown as BucketFeature, [[new Point(0, 0), new Point(10, 10)]], 0, world, {}, {}, SubdivisionGranularitySetting.noSubdivision);
        expect(bucket.layoutVertexArray2.length).toBe(0);
    });
});
