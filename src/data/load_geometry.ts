import {warnOnce, clamp} from '../util/util.ts';
import {EXTENT} from './extent.ts';

import type Point from '@mapbox/point-geometry';
import type {VectorTileFeatureLike} from '@maplibre/vt-pbf';

// These bounds define the minimum and maximum supported coordinate values.
// While visible coordinates are within [0, EXTENT], tiles may theoretically
// contain coordinates within [-Infinity, Infinity]. Our range is limited by the
// number of bits used to represent the coordinate.
const BITS = 15;
const MAX = Math.pow(2, BITS - 1) - 1;
const MIN = -MAX - 1;

/**
 * Loads a geometry from a VectorTileFeatureLike and scales it to the common extent
 * used internally.
 * @param feature - the vector tile feature to load
 */
export function loadGeometry(feature: VectorTileFeatureLike): Point[][] {
    const scale = EXTENT / feature.extent;
    const geometry = feature.loadGeometry();
    let outside = false;
    for (const ring of geometry) {
        for (const point of ring) {
            // round here because mapbox-gl-native uses integers to represent
            // points and we need to do the same to avoid rendering differences.
            point.x = Math.round(point.x * scale);
            point.y = Math.round(point.y * scale);
            if (point.x < MIN || point.x > MAX || point.y < MIN || point.y > MAX) outside = true;
        }
    }
    if (!outside) return geometry;
    // PARCHMENT: a clamped vertex bends every segment that reaches it, inside the tile too; a line can be cut instead.
    if (feature.type === 2) return clipLines(geometry);

    for (const ring of geometry) {
        for (const point of ring) {
            const {x, y} = point;
            point.x = clamp(x, MIN, MAX);
            point.y = clamp(y, MIN, MAX);

            if (x < point.x || x > point.x + 1 || y < point.y || y > point.y + 1) {
                // warn when exceeding allowed extent except for the 1-px-off case
                // https://github.com/mapbox/mapbox-gl-js/issues/8992
                warnOnce('Geometry exceeds allowed extent, reduce your vector tile buffer size');
            }
        }
    }
    return geometry;
}

const inRange = (p: Point) => p.x >= MIN && p.x <= MAX && p.y >= MIN && p.y <= MAX;

/** Cuts each line to the representable range, splitting it where it leaves and comes back. */
function clipLines(lines: Point[][]): Point[][] {
    const out: Point[][] = [];
    for (const line of lines) {
        let part: Point[] = [];
        for (let i = 0; i < line.length - 1; i++) {
            const seg = clipSegment(line[i], line[i + 1]);
            if (!seg) continue;
            const [a, b] = seg;
            const last = part[part.length - 1];
            if (!last || !last.equals(a)) {
                if (part.length > 1) out.push(part);
                part = [a];
            }
            part.push(b);
        }
        if (part.length > 1) out.push(part);
    }
    return out;
}

/** Liang–Barsky against [MIN, MAX]², with intersections rounded back onto the integer grid. */
function clipSegment(a: Point, b: Point): [Point, Point] | null {
    if (inRange(a) && inRange(b)) return [a, b];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let t0 = 0;
    let t1 = 1;
    for (const [p, q] of [[-dx, a.x - MIN], [dx, MAX - a.x], [-dy, a.y - MIN], [dy, MAX - a.y]]) {
        if (p === 0) {
            if (q < 0) return null;
            continue;
        }
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
        if (t0 > t1) return null;
    }
    const at = (t: number) => {
        if (t === 0) return a;
        if (t === 1) return b;
        const p = a.clone()._add(b.sub(a)._mult(t))._round();
        p.x = clamp(p.x, MIN, MAX);
        p.y = clamp(p.y, MIN, MAX);
        return p;
    };
    return [at(t0), at(t1)];
}
