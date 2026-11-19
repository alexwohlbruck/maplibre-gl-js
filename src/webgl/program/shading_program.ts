import {Uniform1i, Uniform1f, Uniform2f, Uniform3f, UniformMatrix4f} from '../uniform_binding.ts';

import type {Context} from '../context.ts';
import type {UniformLocations} from '../uniform_binding.ts';

/** What every program shaded by the map's shading reads: see `sun_shade` in the fragment prelude. */
export type ShadingReceiverUniformsType = {
    'u_sun_shadow': Uniform1i;
    'u_sun': Uniform3f;
    'u_occlusion': Uniform1i;
    'u_occlusion_strength': Uniform2f;
    'u_ground': Uniform2f;
    'u_shadow_color': Uniform3f;
};

export const shadingReceiverUniforms = (context: Context, locations: UniformLocations): ShadingReceiverUniformsType => ({
    'u_sun_shadow': new Uniform1i(context, locations.u_sun_shadow),
    'u_sun': new Uniform3f(context, locations.u_sun),
    'u_occlusion': new Uniform1i(context, locations.u_occlusion),
    'u_occlusion_strength': new Uniform2f(context, locations.u_occlusion_strength),
    'u_ground': new Uniform2f(context, locations.u_ground),
    'u_shadow_color': new Uniform3f(context, locations.u_shadow_color),
});

/** Where a point of a shaded surface lies in the sun's view and in the ground occlusion. */
export type ShadingMatrixUniformsType = {
    'u_sun_matrix': UniformMatrix4f;
    'u_occlusion_matrix': UniformMatrix4f;
};

export const shadingMatrixUniforms = (context: Context, locations: UniformLocations): ShadingMatrixUniformsType => ({
    'u_sun_matrix': new UniformMatrix4f(context, locations.u_sun_matrix),
    'u_occlusion_matrix': new UniformMatrix4f(context, locations.u_occlusion_matrix),
});

export type ShadingGroundUniformsType = ShadingReceiverUniformsType & ShadingMatrixUniformsType & {
    'u_matrix': UniformMatrix4f;
};

export const shadingGroundUniforms = (context: Context, locations: UniformLocations): ShadingGroundUniformsType => ({
    ...shadingReceiverUniforms(context, locations),
    ...shadingMatrixUniforms(context, locations),
    'u_matrix': new UniformMatrix4f(context, locations.u_matrix),
});

export type ShadingBlurUniformsType = {
    'u_image': Uniform1i;
    'u_step': Uniform2f;
    'u_blur': Uniform2f;
};

export const shadingBlurUniforms = (context: Context, locations: UniformLocations): ShadingBlurUniformsType => ({
    'u_image': new Uniform1i(context, locations.u_image),
    'u_step': new Uniform2f(context, locations.u_step),
    'u_blur': new Uniform2f(context, locations.u_blur),
});

/** A shaded extrusion's own light: see the `SHADING` branch of the fill-extrusion shaders. */
export type ShadedExtrusionUniformsType = ShadingReceiverUniformsType & {
    'u_sun_matrix': UniformMatrix4f;
    'u_shade_strength': Uniform1f;
    'u_shade_band': Uniform1f;
    'u_shade_edge': Uniform1f;
    'u_shade_edge_width': Uniform1f;
    'u_sun_tint': Uniform3f;
    'u_sky_tint': Uniform3f;
    'u_wall_rise': Uniform1f;
    'u_roof_lift': Uniform1f;
    'u_unit_metres': Uniform1f;
    'u_wall_origin': Uniform2f;
};

export const shadedExtrusionUniforms = (context: Context, locations: UniformLocations): ShadedExtrusionUniformsType => ({
    ...shadingReceiverUniforms(context, locations),
    'u_sun_matrix': new UniformMatrix4f(context, locations.u_sun_matrix),
    'u_shade_strength': new Uniform1f(context, locations.u_shade_strength),
    'u_shade_band': new Uniform1f(context, locations.u_shade_band),
    'u_shade_edge': new Uniform1f(context, locations.u_shade_edge),
    'u_shade_edge_width': new Uniform1f(context, locations.u_shade_edge_width),
    'u_sun_tint': new Uniform3f(context, locations.u_sun_tint),
    'u_sky_tint': new Uniform3f(context, locations.u_sky_tint),
    'u_wall_rise': new Uniform1f(context, locations.u_wall_rise),
    'u_roof_lift': new Uniform1f(context, locations.u_roof_lift),
    'u_unit_metres': new Uniform1f(context, locations.u_unit_metres),
    'u_wall_origin': new Uniform2f(context, locations.u_wall_origin),
});
