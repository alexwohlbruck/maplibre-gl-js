/**
 * The geometry of the map's shading: the ground it covers, kept still while the camera moves over it, and the sun's
 * view of that ground.
 *
 * Mercator in, clip out: x and y in 0-1 world units and z in mercator units (metres times `perMetre`).
 */

export type Mat4 = Float64Array;

const EARTH_CIRCUMFERENCE = 40075016.686;

/** Column-major a × b. */
export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
    const out = new Float64Array(16);
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        }
    }
    return out;
}

/** A vector tile's own units (8192 a side, z in metres) to mercator. */
export function tileToMercator(z: number, x: number, y: number, wrap: number, perMetre: number): Mat4 {
    const s = 1 / (8192 * 2 ** z);
    return new Float64Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, perMetre, 0, (x + wrap * 2 ** z) / 2 ** z, y / 2 ** z, 0, 1]);
}

/** Mercator units to a metre at a mercator y. */
export function perMetreAt(y: number): number {
    const latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * y)));
    return 1 / (EARTH_CIRCUMFERENCE * Math.cos(latitude));
}

/** A square of ground, mercator: its centre and half its side. */
export type Region = {x: number; y: number; half: number};

/**
 * The square that covers `half` around a point and stays put while the point moves a little: its size is rounded
 * up to a half power of two and its centre to a grid a quarter of that, so what is drawn over it can be kept.
 */
export function steadyRegion(x: number, y: number, half: number): Region {
    const size = 2 ** (Math.ceil(Math.log2(half) * 2) / 2);
    const cell = size / 4;
    return {x: Math.round(x / cell) * cell, y: Math.round(y / cell) * cell, half: size + cell / 2};
}

/** The unit square, 0 to 1, onto a region of flat ground. */
export function regionQuad(region: Region): Mat4 {
    const side = region.half * 2;
    return new Float64Array([side, 0, 0, 0, 0, side, 0, 0, 0, 0, 1, 0, region.x - region.half, region.y - region.half, 0, 1]);
}

/** A region seen from straight overhead, filling the clip square; heights are dropped. */
export function overheadMatrix(region: Region): Mat4 {
    const s = 1 / region.half;
    return new Float64Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, 0, 0, -region.x * s, -region.y * s, 0, 1]);
}

/** Clip space, -1 to 1, to texture coordinates. */
export const CLIP_TO_UV: Mat4 = new Float64Array([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0.5, 0.5, 0.5, 1]);

const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
};

export type SunView = {
    /** The ground shadows are cast over. */
    region: Region;
    /** Which way the light travels, east, north, up: down and away from the sun. */
    toward: [number, number, number];
    /** The ground's height, metres, with terrain on. */
    floor: number;
    /** The tallest caster, metres above the floor; the map's depth range runs this far up. */
    ceiling: number;
    /** Texels on a side of the shadow map. */
    size: number;
};

/** Metres; the least height the map reaches across the light, for a view narrower than a house. */
const MIN_COVERED_HEIGHT = 30;

/**
 * How high across the light the map reaches, metres above the floor: the ground's width, so a roof in view is
 * covered without spending texels on sky. Taller casters still shade it, through the depth range.
 */
export function coveredHeight(span: number, ceiling: number): number {
    return Math.min(ceiling, Math.max(span, MIN_COVERED_HEIGHT));
}

/**
 * The sun's view of a region: an orthographic box down the light, around the ground and everything standing on it.
 */
export function sunLightMatrix(view: SunView): {light: Mat4; perMetre: number; depthPerMetre: number; texelMetres: number} {
    const {region, ceiling, floor} = view;
    const perMetre = perMetreAt(region.y);
    const f = norm(view.toward);
    const r = norm(Math.abs(f[2]) > 0.999 ? [1, 0, 0] : cross(f, [0, 0, 1]));
    const u = cross(r, f);

    const reach = region.half / perMetre;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const covered = coveredHeight(reach * 2, ceiling);
    // Terrain dips below the floor as well as rising above it.
    for (const e of [-reach, reach]) {
        for (const n of [-reach, reach]) {
            for (const h of [floor - ceiling * 0.25, floor + covered, floor + ceiling]) {
                const l = [e * r[0] + n * r[1] + h * r[2], e * u[0] + n * u[1] + h * u[2], e * f[0] + n * f[1] + h * f[2]];
                // Across the light only up to the covered height; along it, all the way to the ceiling.
                for (let i = h > floor + covered ? 2 : 0; i < 3; i++) {
                    lo[i] = Math.min(lo[i], l[i]);
                    hi[i] = Math.max(hi[i], l[i]);
                }
            }
        }
    }
    // Casters just outside the region still throw shadow into it.
    lo[2] -= ceiling;
    const sx = 2 / (hi[0] - lo[0]), sy = 2 / (hi[1] - lo[1]), sz = 2 / (hi[2] - lo[2]);
    // Rows of light-clip ← metric (east, north, up).
    const rows = [
        [r[0] * sx, r[1] * sx, r[2] * sx, -lo[0] * sx - 1],
        [u[0] * sy, u[1] * sy, u[2] * sy, -lo[1] * sy - 1],
        [f[0] * sz, f[1] * sz, f[2] * sz, -lo[2] * sz - 1],
        [0, 0, 0, 1],
    ];
    // Metric ← mercator: east = (x - cx) / pm, north = -(y - cy) / pm, up = z / pm.
    const k = 1 / perMetre;
    const metric = new Float64Array([k, 0, 0, 0, 0, -k, 0, 0, 0, 0, k, 0, -region.x * k, region.y * k, 0, 1]);
    const light = new Float64Array(16);
    for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) light[c * 4 + row] = rows[row][c];
    return {
        light: multiply(light, metric),
        perMetre,
        depthPerMetre: 1 / (hi[2] - lo[2]),
        texelMetres: Math.max(hi[0] - lo[0], hi[1] - lo[1]) / view.size,
    };
}
