import {describe, expect, test, vi} from 'vitest';
import {Shading} from './shading.ts';

import type {Painter} from '../painter.ts';
import type {Style} from '../../style/style.ts';
import type {FrameRenderContext} from '../frame_render_context.ts';

type Frame = {painter: Painter; style: Style; frameRenderContext: FrameRenderContext};

/** A frame with the camera at a zoom and nothing to draw. */
function frameAt(zoom: number, layers: Array<{id: string; casts: boolean; hidden?: boolean}> = []): Frame {
    const styleLayers = Object.fromEntries(layers.map(l => [l.id, {
        id: l.id, type: 'fill-extrusion', source: 'buildings', muted: false,
        isHidden: () => !!l.hidden,
        paint: {get: (name: string) => name === 'fill-extrusion-cast-shadows' ? l.casts : {constantOr: () => 1}},
    }]));
    return {
        painter: {} as Painter,
        style: {_order: layers.map(l => l.id), _layers: styleLayers, tileManagers: {}} as unknown as Style,
        frameRenderContext: {
            projectedCamera: {zoom, pitch: 40, width: 400, height: 800, tileSize: 512},
            data: {pixelRatio: 2},
            terrain: null,
        } as unknown as FrameRenderContext,
    };
}

function prepare(shading: Shading, frame: Frame): void {
    shading.prepare(frame.style, frame.frameRenderContext);
}

describe('Shading', () => {
    test('shades only layers that cast, and only from its first zoom', () => {
        const layers = [{id: 'rooms', casts: false}, {id: 'buildings', casts: true}];
        const frame = frameAt(15, layers);
        const shading = new Shading(frame.painter, {minZoom: 14});
        prepare(shading, frame);
        const [rooms, buildings] = layers.map(l => frame.style._layers[l.id]) as any[];
        expect(shading.shades(buildings)).toBe(true);
        expect(shading.shades(rooms)).toBe(false);
        expect(shading.groundLayer).toBe('buildings');

        prepare(shading, frameAt(13, layers));
        expect(shading.shades(buildings)).toBe(false);
    });

    test('leaves the ground alone with nothing to cast on it', () => {
        const frame = frameAt(16, [{id: 'buildings', casts: true}]);
        const shading = new Shading(frame.painter);
        prepare(shading, frame);
        expect(shading.shadesGround()).toBe(false);
        expect(shading.frame).toBeNull();
    });

    test('asks the pitch how much of the shadows shows, and draws none at zero', () => {
        const visibility = vi.fn(() => 0);
        const frame = frameAt(16, [{id: 'buildings', casts: true}]);
        const shading = new Shading(frame.painter, {visibility, casters: new Set([{drawSunDepth: vi.fn()}])});
        prepare(shading, frame);
        expect(visibility).toHaveBeenCalledWith(40);
        expect(shading.frame).toBeNull();
        expect(shading.active).toBe(true);
    });

    test('the ground effects ramp in over the zooms past the first', () => {
        const shading = new Shading({} as Painter, {minZoom: 14, fadeZoom: 2});
        prepare(shading, frameAt(14));
        expect(shading.groundOpacity()).toBe(0);
        prepare(shading, frameAt(15));
        expect(shading.groundOpacity()).toBe(0.5);
        prepare(shading, frameAt(17));
        expect(shading.groundOpacity()).toBe(1);
    });

    test('draws no lamplight until it is given an intensity', () => {
        const drawLights = vi.fn();
        const receiveLights = vi.fn();
        const frame = frameAt(16);
        const shading = new Shading(frame.painter, {groundOcclusion: false, sunShadows: false, casters: new Set([{drawLights, receiveLights}])});
        prepare(shading, frame);
        expect(drawLights).not.toHaveBeenCalled();
        expect(receiveLights).not.toHaveBeenCalled();
        expect(shading.shadesGround()).toBe(false);
        expect(shading.drawn.lights).toBe(0);
    });

    test('hands the wall shader over as fragment source, or nothing', () => {
        const shading = new Shading({} as Painter);
        expect(shading.wallSource()).toBeNull();
        shading.wallShader = {source: 'vec3 shade_wall(vec3 c, vec3 w, float s, float k) { return c; }'};
        expect(shading.wallSource()).toContain('#define SHADING_WALL\n');
    });
});
