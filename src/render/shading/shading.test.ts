import {describe, expect, test, vi} from 'vitest';
import {Shading} from './shading.ts';

import type {Painter} from '../painter.ts';

/** A painter with the camera at a zoom and nothing to draw. */
function painterAt(zoom: number, layers: Array<{id: string; casts: boolean; hidden?: boolean}> = []): Painter {
    const styleLayers = Object.fromEntries(layers.map(l => [l.id, {
        id: l.id, type: 'fill-extrusion', source: 'buildings', muted: false,
        isHidden: () => !!l.hidden,
        paint: {get: (name: string) => name === 'fill-extrusion-cast-shadows' ? l.casts : 1},
    }]));
    return {
        transform: {zoom, pitch: 40, width: 400, height: 800, tileSize: 512},
        pixelRatio: 2,
        style: {_order: layers.map(l => l.id), _layers: styleLayers, tileManagers: {}, map: {terrain: null}},
    } as unknown as Painter;
}

describe('Shading', () => {
    test('shades only layers that cast, and only from its first zoom', () => {
        const layers = [{id: 'rooms', casts: false}, {id: 'buildings', casts: true}];
        const shading = new Shading(painterAt(15, layers), {minZoom: 14});
        shading.prepare();
        const [rooms, buildings] = layers.map(l => shading.painter.style._layers[l.id]) as any[];
        expect(shading.shades(buildings)).toBe(true);
        expect(shading.shades(rooms)).toBe(false);
        expect(shading.groundLayer).toBe('buildings');

        shading.painter = painterAt(13, layers);
        shading.prepare();
        expect(shading.shades(buildings)).toBe(false);
    });

    test('leaves the ground alone with nothing to cast on it', () => {
        const shading = new Shading(painterAt(16, [{id: 'buildings', casts: true}]));
        shading.prepare();
        expect(shading.shadesGround()).toBe(false);
        expect(shading.frame).toBeNull();
    });

    test('asks the pitch how much of the shadows shows, and draws none at zero', () => {
        const visibility = vi.fn(() => 0);
        const shading = new Shading(painterAt(16, [{id: 'buildings', casts: true}]), {visibility, casters: new Set([{drawSunDepth: vi.fn()}])});
        shading.prepare();
        expect(visibility).toHaveBeenCalledWith(40);
        expect(shading.frame).toBeNull();
        expect(shading.active).toBe(true);
    });

    test('the ground effects ramp in over the zooms past the first', () => {
        const shading = new Shading(painterAt(14, []), {minZoom: 14, fadeZoom: 2});
        expect(shading.groundOpacity()).toBe(0);
        shading.painter = painterAt(15, []);
        expect(shading.groundOpacity()).toBe(0.5);
        shading.painter = painterAt(17, []);
        expect(shading.groundOpacity()).toBe(1);
    });

    test('draws no lamplight until it is given an intensity', () => {
        const drawLights = vi.fn();
        const receiveLights = vi.fn();
        const shading = new Shading(painterAt(16), {groundOcclusion: false, sunShadows: false, casters: new Set([{drawLights, receiveLights}])});
        shading.prepare();
        expect(drawLights).not.toHaveBeenCalled();
        expect(receiveLights).not.toHaveBeenCalled();
        expect(shading.shadesGround()).toBe(false);
        expect(shading.drawn.lights).toBe(0);
    });

    test('hands the wall shader over as fragment source, or nothing', () => {
        const shading = new Shading(painterAt(16));
        expect(shading.wallSource()).toBeNull();
        shading.wallShader = {source: 'vec3 shade_wall(vec3 c, vec3 w, float s, float k) { return c; }'};
        expect(shading.wallSource()).toContain('#define SHADING_WALL\n');
    });
});
