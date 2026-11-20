import {beforeEach, test, expect} from 'vitest';
import {createMap, beforeMapTest} from '../../util/test/util.ts';

beforeEach(() => {
    beforeMapTest();
    global.fetch = null;
});

test('setNearFarZ draws with the given clip distances until cleared', () => {
    const map = createMap({pitch: 0});
    const computed = map._camera.projectedCamera.nearZ;

    map.setNearFarZ({nearZ: 5000, farZ: 20000});
    expect(map.getNearFarZ()).toEqual({nearZ: 5000, farZ: 20000});
    expect(map._camera.projectedCamera.nearZ).toBe(5000);
    expect(map._camera.projectedCamera.farZ).toBe(20000);

    map.setZoom(map.getZoom() + 1);
    expect(map._camera.projectedCamera.nearZ).toBe(5000);

    map.setNearFarZ(null);
    expect(map.getNearFarZ()).toBeNull();
    expect(map._camera.projectedCamera.nearZ).toBe(computed);
});
