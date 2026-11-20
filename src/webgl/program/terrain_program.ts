import {
    Uniform1i,
    Uniform1f,
    Uniform2f,
    Uniform4f,
    UniformMatrix4f,
    UniformColor
} from '../uniform_binding.ts';
import {Color} from '@maplibre/maplibre-gl-style-spec';
import {shadingReceiverUniforms, shadingMatrixUniforms, type ShadingReceiverUniformsType, type ShadingMatrixUniformsType} from './shading_program.ts';
import {calculateFogBlendOpacity} from '../../style/sky.ts';
import {sphericalToCartesian} from '../../util/util.ts';
import {earthRadius} from '../../geo/lng_lat.ts';

import type {SkyPropsPossiblyEvaluated} from '../../style/sky_properties.g.ts';
import type {LightPropsPossiblyEvaluated} from '../../style/light_properties.g.ts';
import type {mat4} from 'gl-matrix';
import type {UniformValues, UniformLocations} from '../uniform_binding.ts';
import type {Context} from '../../webgl/context.ts';

export type TerrainPreludeUniformsType = {
    'u_depth': Uniform1i;
    'u_terrain': Uniform1i;
};

export type TerrainUniformsType = {
    'u_texture': Uniform1i;
    'u_ele_delta': Uniform1f;
    'u_fog_matrix': UniformMatrix4f;
    'u_fog_color': UniformColor;
    'u_fog_ground_blend': Uniform1f;
    'u_fog_ground_blend_opacity': Uniform1f;
    'u_horizon_color': UniformColor;
    'u_horizon_fog_blend': Uniform1f;
    'u_is_globe_mode': Uniform1f;
    'u_relief': Uniform4f;
    'u_relief_scale': Uniform2f;
} & Partial<ShadingReceiverUniformsType & ShadingMatrixUniformsType>;

/**
 * The terrain's relief shading for one tile: the light's direction in tile space (z up) and the shading's strength,
 * 0 for none; then the metres a tile unit spans and the light's intensity.
 */
export type TerrainRelief = {light: [number, number, number, number]; scale: [number, number]};

const NO_RELIEF: TerrainRelief = {light: [0, 0, 1, 0], scale: [1, 0]};

/**
 * A tile's relief shading under the style's light, as fill extrusions are lit: `bearing` in radians turns a light
 * anchored to the viewport with the camera.
 */
export function terrainRelief(
    light: Readonly<LightPropsPossiblyEvaluated> | undefined,
    bearing: number,
    strength: number,
    tile: {z: number; y: number},
): TerrainRelief {
    if (!light || !(strength > 0)) return NO_RELIEF;
    const [x, y, z] = sphericalToCartesian(light.position);
    const [c, s] = light.anchor === 'viewport' ? [Math.cos(bearing), Math.sin(bearing)] : [1, 0];
    const [lx, ly] = [c * x - s * y, s * x + c * y];
    const length = Math.hypot(lx, ly, z) || 1;
    const n = Math.PI - 2 * Math.PI * (tile.y + 0.5) / 2 ** tile.z;
    const latitude = Math.atan(Math.sinh(n));
    const unitMetres = 2 * Math.PI * earthRadius * Math.cos(latitude) / 2 ** tile.z / 8192;
    return {light: [lx / length, ly / length, z / length, strength], scale: [unitMetres, light.intensity]};
}

export type TerrainDepthUniformsType = {
    'u_ele_delta': Uniform1f;
};

export type TerrainHeightUniformsType = {
    'u_tile_bounds': Uniform4f;
};

const terrainPreludeUniforms = (context: Context, locations: UniformLocations): TerrainPreludeUniformsType => ({
    'u_depth': new Uniform1i(context, locations.u_depth),
    'u_terrain': new Uniform1i(context, locations.u_terrain)
});

const terrainUniforms = (context: Context, locations: UniformLocations): TerrainUniformsType => ({
    'u_texture': new Uniform1i(context, locations.u_texture),
    'u_ele_delta': new Uniform1f(context, locations.u_ele_delta),
    'u_fog_matrix': new UniformMatrix4f(context, locations.u_fog_matrix),
    'u_fog_color': new UniformColor(context, locations.u_fog_color),
    'u_fog_ground_blend': new Uniform1f(context, locations.u_fog_ground_blend),
    'u_fog_ground_blend_opacity': new Uniform1f(context, locations.u_fog_ground_blend_opacity),
    'u_horizon_color': new UniformColor(context, locations.u_horizon_color),
    'u_horizon_fog_blend': new Uniform1f(context, locations.u_horizon_fog_blend),
    'u_is_globe_mode': new Uniform1f(context, locations.u_is_globe_mode),
    'u_relief': new Uniform4f(context, locations.u_relief),
    'u_relief_scale': new Uniform2f(context, locations.u_relief_scale),
    // Set only while the map's shading lies on the terrain.
    ...(locations.u_sun_matrix ? {...shadingReceiverUniforms(context, locations), ...shadingMatrixUniforms(context, locations)} : {}),
});

const terrainDepthUniforms = (context: Context, locations: UniformLocations): TerrainDepthUniformsType => ({
    'u_ele_delta': new Uniform1f(context, locations.u_ele_delta)
});

const terrainHeightUniforms = (context: Context, locations: UniformLocations): TerrainHeightUniformsType => ({
    'u_tile_bounds': new Uniform4f(context, locations.u_tile_bounds)
});

const terrainUniformValues = (
    eleDelta: number,
    fogMatrix: mat4,
    sky: Readonly<SkyPropsPossiblyEvaluated> | undefined,
    pitch: number,
    isGlobeMode: boolean,
    relief: TerrainRelief = NO_RELIEF): UniformValues<TerrainUniformsType> => ({
    'u_texture': 0,
    'u_ele_delta': eleDelta,
    'u_fog_matrix': fogMatrix,
    'u_fog_color': sky ? sky['fog-color'] : Color.white,
    'u_fog_ground_blend': sky ? sky['fog-ground-blend'] : 1,
    // Set opacity to 0 when in globe mode to disable fog
    'u_fog_ground_blend_opacity': isGlobeMode ? 0 : (sky ? calculateFogBlendOpacity(pitch) : 0),
    'u_horizon_color': sky ? sky['horizon-color'] : Color.white,
    'u_horizon_fog_blend': sky ? sky['horizon-fog-blend'] : 1,
    'u_is_globe_mode': isGlobeMode ? 1 : 0,
    'u_relief': relief.light,
    'u_relief_scale': relief.scale
});

const terrainDepthUniformValues = (
    eleDelta: number
): UniformValues<TerrainDepthUniformsType> => ({
    'u_ele_delta': eleDelta
});

/**
 * @param tileBounds - the tile's west and north edge and its width and height, as fractions of the height map
 */
const terrainHeightUniformValues = (
    tileBounds: [number, number, number, number]
): UniformValues<TerrainHeightUniformsType> => ({
    'u_tile_bounds': tileBounds
});

export {terrainUniforms, terrainDepthUniforms, terrainHeightUniforms, terrainPreludeUniforms, terrainUniformValues, terrainDepthUniformValues, terrainHeightUniformValues};
