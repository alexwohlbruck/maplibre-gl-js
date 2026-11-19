import {EXTENT} from '../data/extent.ts';
import {mercatorXfromLng, mercatorYfromLat} from '../geo/mercator_coordinate.ts';

import type {CanonicalTileID} from '../tile/tile_id.ts';

type ClipPolygon = {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    /** Each ring as flat mercator x, y pairs. */
    rings: number[][];
};

/**
 * An area whose symbols are left out at placement, for a set of layers: each symbol whose anchor lies in one of
 * its polygons. Unlike a `within` filter it costs no tile reload to change, as the symbols stay in their buckets
 * and are only never placed, and it takes a line running out of the area symbol by symbol, not whole.
 */
export type SymbolClip = {
    layerIds: ReadonlySet<string>;
    polygons: ClipPolygon[];
};

export function createSymbolClip(layerIds: string[], area: GeoJSON.Polygon | GeoJSON.MultiPolygon): SymbolClip {
    const polygons: ClipPolygon[] = [];
    for (const polygon of area.type === 'Polygon' ? [area.coordinates] : area.coordinates) {
        const clip: ClipPolygon = {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, rings: []};
        for (const ring of polygon) {
            const flat: number[] = [];
            for (const [lng, lat] of ring) {
                const x = mercatorXfromLng(lng);
                const y = mercatorYfromLat(lat);
                flat.push(x, y);
                clip.minX = Math.min(clip.minX, x);
                clip.minY = Math.min(clip.minY, y);
                clip.maxX = Math.max(clip.maxX, x);
                clip.maxY = Math.max(clip.maxY, y);
            }
            clip.rings.push(flat);
        }
        if (clip.rings.length) polygons.push(clip);
    }
    return {layerIds: new Set(layerIds), polygons};
}

function contains(polygon: ClipPolygon, x: number, y: number): boolean {
    if (x < polygon.minX || x > polygon.maxX || y < polygon.minY || y > polygon.maxY) return false;
    let inside = false;
    for (const ring of polygon.rings) {
        for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
            const [xi, yi, xj, yj] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
        }
    }
    return inside;
}

/** Whether a and b lie strictly on opposite sides of the line through c and d. */
function twoSided(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
    const side1 = (ax - cx) * (dy - cy) - (dx - cx) * (ay - cy);
    const side2 = (bx - cx) * (dy - cy) - (dx - cx) * (by - cy);
    return (side1 > 0 && side2 < 0) || (side1 < 0 && side2 > 0);
}

function crosses(polygon: ClipPolygon, ax: number, ay: number, bx: number, by: number): boolean {
    for (const ring of polygon.rings) {
        for (let i = 0; i < ring.length - 2; i += 2) {
            const [cx, cy, dx, dy] = [ring[i], ring[i + 1], ring[i + 2], ring[i + 3]];
            if (twoSided(ax, ay, bx, by, cx, cy, dx, dy) && twoSided(cx, cy, dx, dy, ax, ay, bx, by)) return true;
        }
    }
    return false;
}

/** As the `within` expression has it: every point in one polygon, and no segment across its edge. */
function holds(polygon: ClipPolygon, points: number[]): boolean {
    for (let i = 0; i < points.length; i += 2) {
        if (!contains(polygon, points[i], points[i + 1])) return false;
    }
    for (let i = 0; i < points.length - 2; i += 2) {
        if (crosses(polygon, points[i], points[i + 1], points[i + 2], points[i + 3])) return false;
    }
    return true;
}

/**
 * A test of a symbol's point or line, as flat x, y pairs in tile units, against the clip; null where the
 * clip leaves the tile's symbols alone, so the common case costs nothing per symbol.
 */
export function symbolClipTester(clip: SymbolClip, layerIds: string[], tile: CanonicalTileID): ((points: number[]) => boolean) | null {
    if (!layerIds.some(id => clip.layerIds.has(id))) return null;
    const size = 1 / (1 << tile.z);
    const [x0, y0] = [tile.x * size, tile.y * size];
    const near = clip.polygons.filter(p => p.minX <= x0 + size && p.maxX >= x0 && p.minY <= y0 + size && p.maxY >= y0);
    if (!near.length) return null;
    const unit = size / EXTENT;
    return (points) => {
        const world = points.map((v, i) => (i % 2 ? y0 : x0) + v * unit);
        return near.some(p => holds(p, world));
    };
}
