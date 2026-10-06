/**
 * Fork extensions to the MapLibre style specification.
 *
 * These are properties this fork adds ahead of upstream adoption. The spec
 * reference object (`v8` === `latest`) is a module singleton shared by style
 * validation, expression parsing, and the style-code generator — mutating it
 * here, once, at import time makes the new properties first-class citizens
 * everywhere without patching node_modules.
 *
 * This file IS the spec diff for the upstream proposal to
 * maplibre/maplibre-style-spec: each entry below maps 1:1 onto an addition
 * to reference/v8.json there.
 */
import {v8} from '@maplibre/maplibre-gl-style-spec';

const layoutSymbol = (v8 as any).layout_symbol;
const layoutLine = (v8 as any).layout_line;

if (!layoutLine['line-rounded-corner-distance']) {
    // The line counterpart of `fill-extrusion-rounded-corner-distance`: polygon
    // outlines are rounded with the same code and in the same units, so an
    // outline drawn over a rounded extrusion follows its corners exactly.
    layoutLine['line-rounded-corner-distance'] = {
        'type': 'number',
        'default': 0,
        'minimum': 0,
        'units': 'meters',
        'doc': 'Rounds the corners of polygon outlines by this distance, matching `fill-extrusion-rounded-corner-distance`. Has no effect on line geometry.',
        'expression': {
            'interpolated': false,
            'parameters': []
        },
        'property-type': 'data-constant'
    };
}

if (!layoutSymbol['symbol-anchor-offset']) {
    // A pixel offset applied to the symbol's ANCHOR — not the image frame.
    // Unlike `icon-offset`/`text-offset` it is unaffected by `icon-rotate`,
    // and with `symbol-anchor-offset-alignment: map` the vector lives in
    // map-aligned space (+x east, +y south) and rotates with the camera
    // while the glyphs keep their own rotation alignment (upright icons
    // whose POSITION tracks the map). Use cases: symbols pinned to a
    // geographic side of a line (transit bullets riding an offset ribbon,
    // roadside labels), wind barbs / flow glyphs, cluster fans around a
    // shared anchor.
    layoutSymbol['symbol-anchor-offset'] = {
        'type': 'array',
        'value': 'number',
        'length': 2,
        'default': [0, 0],
        'units': 'pixels',
        'doc': 'Offset distance of the symbol anchor from its geometry, in pixels. The offset shifts icon and text together and is not affected by `icon-rotate` or scaled by `icon-size`. Interpretation of the vector depends on `symbol-anchor-offset-alignment`.',
        'expression': {
            'interpolated': true,
            'parameters': ['zoom', 'feature']
        },
        'property-type': 'data-driven'
    };
    layoutSymbol['symbol-anchor-offset-alignment'] = {
        'type': 'enum',
        'values': {
            'map': {
                'doc': 'The offset vector is aligned to the map: positive x points east, positive y points south. On screen the vector rotates with the camera bearing (and follows the local surface under pitch), while the symbol itself keeps its own rotation alignment.'
            },
            'viewport': {
                'doc': 'The offset vector is aligned to the viewport: positive x points right, positive y points down, regardless of camera bearing.'
            }
        },
        'default': 'viewport',
        'doc': 'Controls the frame of reference of `symbol-anchor-offset`.',
        'requires': ['symbol-anchor-offset'],
        'expression': {
            'interpolated': false,
            'parameters': ['zoom']
        },
        'property-type': 'data-constant'
    };
}

export {};
