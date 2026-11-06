import type {StyleLayer} from '../../style/style_layer.ts';

/**
 * Lines, symbols and circles fade out with distance from the camera, so a steep pitch does not pile far features
 * up along the horizon. A layer opts out with metadata `parchment:horizon-fade: false`.
 */
export function horizonFadeDefines(layer: StyleLayer): string[] {
    return (layer.metadata as Record<string, unknown> | undefined)?.['parchment:horizon-fade'] === false ? [] : ['#define HORIZON_FADE'];
}
