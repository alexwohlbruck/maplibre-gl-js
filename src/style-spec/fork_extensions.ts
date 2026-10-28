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
const paintLine = (v8 as any).paint_line;

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

if (!layoutLine['line-elevation-profile']) {
    // Heights along a line for drawing it off the ground over terrain: bridges
    // raised to their decks, tunnels sunk to their bores. Carried as a feature
    // property so a tile can state them per line; the points are geographic, so
    // they survive clipping, simplification and re-tiling of the geometry.
    layoutLine['line-elevation-profile'] = {
        'type': 'string',
        'default': '',
        'doc': 'Heights of the line above the terrain, as runs separated by `;`. Each run is a comma-separated list of integer triples: the first is longitude and latitude in 1e-7 degrees and height in decimetres, each later one the change in longitude and latitude from the point before and its own height. Points lie on the line in its direction; the line is raised by the height interpolated between the points of a run and lies on the terrain outside the runs. A layer with a profile is drawn in 3D rather than draped over terrain, and only while terrain is enabled.',
        'expression': {
            'interpolated': false,
            'parameters': ['zoom', 'feature']
        },
        'property-type': 'data-driven'
    };
    paintLine['line-depth-occlusion-factor'] = {
        'type': 'number',
        'default': 1,
        'minimum': 0,
        'maximum': 1,
        'doc': 'Whether a line drawn with `line-elevation-profile` is hidden behind 3D features nearer the camera: 0 draws it over them, any larger value hides it. Underground stretches are never hidden by the terrain over them.',
        'requires': ['line-elevation-profile'],
        'expression': {
            'interpolated': false,
            'parameters': ['zoom']
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
