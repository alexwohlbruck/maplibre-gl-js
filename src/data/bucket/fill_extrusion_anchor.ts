import {EXTENT} from '../extent.ts';

import type Point from '@mapbox/point-geometry';

/**
 * Where a building's ground height is read under 3D terrain: one point every tile holding a piece of the
 * building agrees on, so its pieces stand at one elevation, with the reach of the footprint around it packed
 * into the low three bits of each coordinate so the lowest ground under it can be found and no side floats.
 */
export type TerrainAnchor = {x: number; y: number};

const GRID = 8;

const snapped = (v: number) => Math.max(0, Math.floor(v / GRID) * GRID);

/** A half extent as the power of two that covers it, in three bits; zero for one within a grid cell. */
const reach = (half: number) => (half <= GRID ? 0 : Math.max(1, Math.min(7, Math.ceil(Math.log2(half / GRID)))));

/**
 * The anchor of a polygon, or null where the tile holding the centre of its bounds draws it instead.
 * A piece cut by a tile edge anchors on the edge, midway along what it cuts, where its neighbour's piece
 * anchors too; one cut by two edges anchors on their corner.
 */
export function terrainAnchor(polygon: Point[][]): TerrainAnchor | null {
    let [west, east, north, south] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const ring of polygon) {
        for (const p of ring) {
            if (p.x < west) west = p.x;
            if (p.x > east) east = p.x;
            if (p.y < north) north = p.y;
            if (p.y > south) south = p.y;
        }
    }
    const [x, y] = [(west + east) / 2, (north + south) / 2];
    if (!(east >= west) || x < 0 || x >= EXTENT || y < 0 || y >= EXTENT) return null;

    // The widest cut by an edge running north-south, and by one running east-west: its span, edge and middle.
    const cuts = [{span: -1, edge: 0, middle: 0}, {span: -1, edge: 0, middle: 0}];
    for (const [vertical, edge] of [[true, 0], [true, EXTENT], [false, 0], [false, EXTENT]] as Array<[boolean, number]>) {
        if (vertical ? !(west < edge && east > edge) : !(north < edge && south > edge)) continue;
        let [low, high] = [Infinity, -Infinity];
        for (const ring of polygon) {
            for (let i = 1; i < ring.length; i++) {
                const [p, q] = [ring[i - 1], ring[i]];
                const [pa, qa] = vertical ? [p.x, q.x] : [p.y, q.y];
                if ((pa < edge) === (qa < edge)) continue;
                const t = (edge - pa) / (qa - pa);
                const crossing = vertical ? p.y + (q.y - p.y) * t : p.x + (q.x - p.x) * t;
                if (crossing < low) low = crossing;
                if (crossing > high) high = crossing;
            }
        }
        const cut = cuts[vertical ? 0 : 1];
        if (high >= low && high - low > cut.span) {
            cut.span = high - low;
            cut.edge = edge;
            cut.middle = (low + high) / 2;
        }
    }

    const [byColumn, byRow] = cuts;
    if (byColumn.span >= 0 && byRow.span >= 0) return {x: byColumn.edge, y: byRow.edge};
    if (byColumn.span >= 0) return {x: byColumn.edge, y: snapped(byColumn.middle) + reach(byColumn.span / 2)};
    if (byRow.span >= 0) return {x: snapped(byRow.middle) + reach(byRow.span / 2), y: byRow.edge};
    return {x: snapped(x) + reach((east - west) / 2), y: snapped(y) + reach((south - north) / 2)};
}

/** The lowest ground over an anchor's reach: at its point, and at the four corners around it. */
export function anchorElevation(x: number, y: number, elevationAt: (x: number, y: number) => number): number {
    const [px, py] = [Math.floor(x / GRID) * GRID, Math.floor(y / GRID) * GRID];
    const [cx, cy] = [x - px, y - py];
    const [rx, ry] = [cx < 0.5 ? 0 : GRID * 2 ** cx, cy < 0.5 ? 0 : GRID * 2 ** cy];
    let lowest = elevationAt(px, py);
    if (rx || ry) {
        lowest = Math.min(lowest, elevationAt(px + rx, py + ry), elevationAt(px - rx, py - ry), elevationAt(px + rx, py - ry), elevationAt(px - rx, py + ry));
    }
    return lowest;
}
