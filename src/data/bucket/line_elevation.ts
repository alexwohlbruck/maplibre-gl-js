import Point from '@mapbox/point-geometry';
import {EXTENT} from '../extent.ts';

import type {CanonicalTileID} from '../../tile/tile_id.ts';

/**
 * A stretch of a line off the ground: points on the line, in tile units, with their heights in metres, above
 * sea level in the terrain's datum or, for a relative run, above the terrain under them.
 */
export type ElevationRun = {
    points: Point[];
    heights: number[];
    relative: boolean;
};

/** A run's prefix for heights measured from the terrain rather than from sea level. */
const RELATIVE_PREFIX = '~';

/** How far from the line, in tile units, a profile point may lie and still be placed on it. */
const SNAP_TOLERANCE = 8;
/** Projections closer than this to a vertex, as a fraction of their segment, land on the vertex. */
const VERTEX_EPSILON = 1e-6;

function tileX(lng: number, canonical: CanonicalTileID): number {
    return ((lng + 180) / 360 * (1 << canonical.z) - canonical.x) * EXTENT;
}

function tileY(lat: number, canonical: CanonicalTileID): number {
    const sin = Math.sin(lat * Math.PI / 180);
    const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
    return (y * (1 << canonical.z) - canonical.y) * EXTENT;
}

/** Decodes a `line-elevation-profile` string into runs in the tile's units. */
export function parseElevationProfile(profile: string, canonical: CanonicalTileID): ElevationRun[] {
    const runs: ElevationRun[] = [];
    if (!profile) return runs;
    for (const text of profile.split(';')) {
        const relative = text.startsWith(RELATIVE_PREFIX);
        const values = (relative ? text.slice(RELATIVE_PREFIX.length) : text).split(',').map(Number);
        if (values.length < 6 || values.length % 3 !== 0 || values.some(v => !Number.isFinite(v))) continue;
        const run: ElevationRun = {points: [], heights: [], relative};
        let lng = 0, lat = 0;
        for (let i = 0; i < values.length; i += 3) {
            lng += values[i];
            lat += values[i + 1];
            run.points.push(new Point(tileX(lng * 1e-7, canonical), tileY(lat * 1e-7, canonical)));
            run.heights.push(values[i + 2] / 10);
        }
        runs.push(run);
    }
    return runs;
}

type Placed = {segment: number; t: number; height: number; run: number};

/** Where on the line, searched from `from` onwards, a point falls; null if it lies off the line. */
function place(vertices: Point[], point: Point, from: number): {segment: number; t: number; distance: number} | null {
    let best: {segment: number; t: number; distance: number} | null = null;
    for (let i = from; i < vertices.length - 1; i++) {
        const a = vertices[i], b = vertices[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const length2 = dx * dx + dy * dy;
        const t = length2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
        const distance = Math.hypot(a.x + dx * t - point.x, a.y + dy * t - point.y);
        if (distance <= SNAP_TOLERANCE && (!best || distance < best.distance)) best = {segment: i, t, distance};
    }
    return best;
}

/**
 * Where each vertex is drawn: `height` metres plus `ground` times the terrain under it. Outside the runs a vertex
 * lies on the terrain; within one its height is interpolated by distance between the run's points.
 */
export type ElevatedLine = {vertices: Point[]; heights: number[]; ground: number[]};

/** The line with the profile's points added as vertices, and where each vertex is drawn. */
export function elevateLine(vertices: Point[], runs: ElevationRun[]): ElevatedLine {
    const placed: Placed[] = [];
    for (const [r, run] of runs.entries()) {
        let from = 0;
        for (const [i, point] of run.points.entries()) {
            const hit = place(vertices, point, from);
            if (!hit) continue;
            from = hit.segment;
            // A point at the end of a segment is the next one's first vertex.
            const next = hit.t >= 1 - VERTEX_EPSILON;
            placed.push({segment: hit.segment + (next ? 1 : 0), t: next ? 0 : hit.t, height: run.heights[i], run: r});
        }
    }
    if (!placed.length) return {vertices, heights: vertices.map(() => 0), ground: vertices.map(() => 1)};
    placed.sort((a, b) => a.segment - b.segment || a.t - b.t);

    const out: Point[] = [];
    const heights: number[] = [];
    const runOf: number[] = [];
    let p = 0;
    for (let i = 0; i < vertices.length; i++) {
        out.push(vertices[i]);
        heights.push(0);
        runOf.push(-1);
        for (; p < placed.length && placed[p].segment === i; p++) {
            const {t, height, run} = placed[p];
            if (t <= VERTEX_EPSILON) {
                heights[out.length - 1] = height;
                runOf[out.length - 1] = run;
                continue;
            }
            const a = vertices[i], b = vertices[i + 1];
            out.push(new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
            heights.push(height);
            runOf.push(run);
        }
    }
    interpolate(out, heights, runOf);
    return {vertices: out, heights, ground: runOf.map(r => (r < 0 || runs[r].relative ? 1 : 0))};
}

/** Fills in the vertices between two placed points of one run by distance along the line. */
function interpolate(vertices: Point[], heights: number[], runOf: number[]): void {
    const along = [0];
    for (let i = 1; i < vertices.length; i++) along.push(along[i - 1] + vertices[i].dist(vertices[i - 1]));
    let last = -1;
    for (let i = 0; i < vertices.length; i++) {
        if (runOf[i] < 0) continue;
        if (last >= 0 && runOf[last] === runOf[i] && i - last > 1) {
            const span = along[i] - along[last];
            for (let k = last + 1; k < i; k++) {
                const f = span ? (along[k] - along[last]) / span : 0;
                heights[k] = heights[last] + (heights[i] - heights[last]) * f;
                runOf[k] = runOf[i];
            }
        }
        last = i;
    }
}
