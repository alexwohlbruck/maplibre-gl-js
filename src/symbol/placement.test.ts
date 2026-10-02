import {beforeEach, describe, expect, test} from 'vitest';
import {CollisionGroups, Placement, RetainedQueryData} from './placement.ts';
import {MercatorTransform} from '../geo/projection/mercator_transform.ts';
import {SymbolStyleLayer} from '../style/style_layer/symbol_style_layer.ts';
import {CollisionBoxArray, SymbolInstanceArray} from '../data/array_types.g.ts';
import {OverscaledTileID} from '../tile/tile_id.ts';
import {FeatureIndex} from '../data/feature_index.ts';

import type {EvaluationParameters} from '../style/evaluation_parameters.ts';

describe('placement', () => {
    let placement: Placement;
    let transform: MercatorTransform;
    beforeEach(() => {
        transform = new MercatorTransform();
        transform.resize(512, 512);
        placement = new Placement(transform, undefined, 0, true);
    });

    test('should not throw on integer overflow', () => {
        const layer = new SymbolStyleLayer({
            id: 'contour-label',
            type: 'symbol',
            source: 'contours',
            'source-layer': 'contours',
            layout: {
                'text-font': ['Test'], 
                'text-field': 'test', 
                'symbol-placement': 'line'
            },
        }, {});
        layer.recalculate({zoom: 22, zoomHistory: {}} as EvaluationParameters, undefined);
        const tileId = new OverscaledTileID(22, 0, 12, 2447, 1666);
        const bucketInstanceId = 1;
        placement.retainedQueryData[bucketInstanceId] = new RetainedQueryData(
            bucketInstanceId,
            new FeatureIndex(tileId),
            0,
            0,
            tileId
        );
        const bucket = {
            bucketInstanceId,
            symbolInstances: new SymbolInstanceArray(),
            collisionArrays: {0: new CollisionBoxArray()},
        };
        const int16Overflow = Math.pow(2, 15) + 1;
        bucket.symbolInstances.emplaceBack(0, 0, 0, int16Overflow, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0);
        bucket.symbolInstances.get(0).crossTileID = 1;
        expect(() => {
            placement.placeLayerBucketPart({
                symbolInstanceStart: 0,
                symbolInstanceEnd: 1,
                parameters: {
                    layout: layer.layout,
                    bucket
                } as any
            }, {}, false);
        }).not.toThrow();
    });
});
describe('CollisionGroups', () => {
    const key = (collisionGroupID: number) => ({collisionGroupID}) as any;

    test('shares one unfiltered group by default', () => {
        const groups = new CollisionGroups(true);
        expect(groups.get('a', 'x')).toEqual({ID: 0, predicate: null});
    });

    test('isolates a layer from every other layer', () => {
        const groups = new CollisionGroups(true, new Set(['dots']));
        const dots = groups.get('a', 'dots');
        const labels = groups.get('a', 'labels');
        expect(dots.ID).not.toBe(0);
        expect(dots.predicate(key(dots.ID))).toBe(true);
        expect(dots.predicate(key(0))).toBe(false);
        expect(labels.ID).toBe(0);
        expect(labels.predicate(key(0))).toBe(true);
        expect(labels.predicate(key(dots.ID))).toBe(false);
    });

    test('keeps per-source groups when cross-source collisions are off', () => {
        const groups = new CollisionGroups(false, new Set(['dots']));
        expect(groups.get('a', 'x')).toBe(groups.get('a', 'y'));
        expect(groups.get('a', 'x').ID).not.toBe(groups.get('b', 'x').ID);
        expect(groups.get('a', 'dots').ID).not.toBe(groups.get('a', 'x').ID);
    });
});
