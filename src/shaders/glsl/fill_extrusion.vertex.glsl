uniform vec3 u_lightcolor;
uniform lowp vec3 u_lightpos;
uniform lowp vec3 u_lightpos_globe;
uniform lowp float u_lightintensity;
uniform float u_vertical_gradient;
uniform lowp float u_opacity;
uniform vec2 u_fill_translate;

layout(location = 0) in vec2 a_pos;
layout(location = 1) in ivec4 a_normal_ed;

#ifdef TERRAIN3D
    // The ground under the building, worked out once on the CPU: see FillExtrusionBucket.updateAnchorElevations.
    layout(location = 2) in float a_anchor_elevation;
#endif


out vec4 v_color;

#ifdef SHADING
// The map's shading (render/shading.ts) in place of the flat light below.
uniform float u_shade_strength;
uniform float u_shade_band;
uniform float u_shade_edge_width;
uniform vec3 u_sun_tint;
uniform vec3 u_sky_tint;
uniform float u_wall_rise;
uniform float u_roof_lift;
uniform mat4 u_sun_matrix;
// Metres to a tile unit, and the tile's corner within its z14 tile: walls are measured on a grid no zoom moves.
uniform float u_unit_metres;
uniform vec2 u_wall_origin;
out vec3 v_ambient;
out float v_facing;
out vec4 v_sun;
out float v_dark;
// Height up the wall (below 0 on a roof), the roofline edge's width in the same units, and how much of it shows.
out vec3 v_edge;
// Metres along the wall, metres up it, and the roof's height (0 on a roof).
out vec3 v_wall;
out vec2 v_facade;

float shade_hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}
#endif

#pragma maplibre: define highp float base
#pragma maplibre: define highp float height

#pragma maplibre: define highp vec4 color

#ifdef SHADING
#pragma maplibre: define highp vec4 roof_color
#pragma maplibre: define highp float facade_style
#pragma maplibre: define highp float facade_seed
#endif

void main() {
    #pragma maplibre: initialize highp float base
    #pragma maplibre: initialize highp float height
    #pragma maplibre: initialize highp vec4 color
    #ifdef SHADING
    #pragma maplibre: initialize highp vec4 roof_color
    #pragma maplibre: initialize highp float facade_style
    #pragma maplibre: initialize highp float facade_seed
    #endif

    // A negative height takes the extrusion out of the frame: a feature state can hide it, where a filter
    // would reload its tile to do the same.
    if (height < 0.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }

    vec3 normal = vec3(a_normal_ed.xyz);

    // The vertical gradient describes the structure itself, so it keeps the extrusion's own
    // base and height before the terrain elevation is added to them below.
    float gradient_base = max(0.0, base);
    float gradient_height = max(0.0, height);

    #ifdef TERRAIN3D
	    // Raise the "ceiling" of elements by the elevation of the centroid, in meters.
        float height_terrain3d_offset = a_anchor_elevation;
        // To avoid having buildings "hang above a slope", create a "basement"
        // by lowering the "floor" of ground-level (and below) elements.
        // This is in addition to the elevation of the centroid, in meters.
        float base_terrain3d_offset = height_terrain3d_offset - (base > 0.0 ? 0.0 : 10.0);
    #else
        float height_terrain3d_offset = 0.0;
        float base_terrain3d_offset = 0.0;
    #endif
    // Sub-terranian "floors and ceilings" are clamped to ground-level.
    // 3D Terrain offsets, if applicable, are applied on the result.
    base = max(0.0, base) + base_terrain3d_offset;
    height = max(0.0, height) + height_terrain3d_offset;

    float t = float(a_normal_ed.x & 1);
    float elevation = t > 0.0 ? height : base;
    vec2 posInTile = a_pos + u_fill_translate;

    #ifdef GLOBE
        vec3 spherePos = projectToSphere(posInTile, a_pos);
        gl_Position = interpolateProjectionFor3D(posInTile, spherePos, elevation);
    #else
        gl_Position = u_projection_matrix * vec4(posInTile, elevation, 1.0);
    #endif

    #ifdef SHADING
    bool wall = a_normal_ed.z < 8192;
    float wall_ratio = wall ? t : -1.0;
    vec2 tangent = normalize(vec2(-normal.y, normal.x) + 1e-6);
    v_wall = vec3(dot(a_pos + u_wall_origin, tangent) * u_unit_metres, t > 0.0 ? gradient_height : gradient_base, wall ? gradient_height : 0.0);
    v_facade = vec2(facade_style, shade_hash(vec2(mod(facade_seed, 256.0), floor(facade_seed / 256.0)) + 0.5));

    // exp(-3) = 0.0498, 1 / (1 - exp(-3)) = 1.0524
    float dark = (wall_ratio < 0.0 || wall_ratio >= u_shade_band) ? 0.0 : (exp(-3.0 * wall_ratio / u_shade_band) - 0.0498) * 1.0524;
    v_dark = u_shade_strength * dark;

    // The roofline edge is a width in pixels: the wall's top and foot differ from this vertex only in height, which
    // the matrix's third column carries, and their distance on screen turns pixels into a share of the wall.
    vec4 top = gl_Position + (height - elevation) * u_projection_matrix[2];
    vec4 foot = gl_Position + (base - elevation) * u_projection_matrix[2];
    float wall_px = (top.w > 0.001 && foot.w > 0.001) ? length((top.xy / top.w - foot.xy / foot.w) * 0.5 * u_viewport_size * u_device_pixel_ratio) : 0.0;
    v_edge = vec3(wall_ratio, min(u_shade_edge_width / max(wall_px, 1.0), 0.25), smoothstep(1.5, 4.0, wall_px / max(u_shade_edge_width, 0.001)));

    vec4 surface = (!wall && roof_color.a > 0.0) ? roof_color : color;
    float luminance = dot(surface.rgb, vec3(0.2126, 0.7152, 0.0722));
    surface.rgb += vec3(0.03);
    vec3 n = normal / 16384.0;
    float directional = clamp(dot(n, u_lightpos), 0.0, 1.0);
    directional = mix(1.0 - u_lightintensity, max(1.0 - luminance + u_lightintensity, 1.0), directional);
    v_facing = dot(n, normalize(u_lightpos));
    float rise = wall ? mix(1.0 - u_wall_rise, 1.0, sqrt(wall_ratio)) : 1.0 + u_roof_lift;
    v_color = vec4(clamp(surface.rgb * directional * mix(u_sky_tint, u_sun_tint, clamp(v_facing, 0.0, 1.0)) * rise, 0.0, 1.0), u_opacity);
    v_ambient = clamp(surface.rgb * (1.0 - u_lightintensity) * u_sky_tint * rise, 0.0, 1.0);
    v_sun = u_sun_matrix * vec4(posInTile, elevation, 1.0);
    #else
    // Relative luminance (how dark/bright is the surface color?)
    float colorvalue = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;

    v_color = vec4(0.0, 0.0, 0.0, 1.0);

    // Add slight ambient lighting so no extrusions are totally black
    vec4 ambientlight = vec4(0.03, 0.03, 0.03, 1.0);
    color += ambientlight;

    // Calculate cos(theta), where theta is the angle between surface normal and diffuse light ray
    vec3 normalForLighting = normal / 16384.0;
    float directional = clamp(dot(normalForLighting, u_lightpos), 0.0, 1.0);

    #ifdef GLOBE
        mat3 rotMatrix = globeGetRotationMatrix(spherePos);
        normalForLighting = rotMatrix * normalForLighting;
        // Interpolate dot product result instead of normals and light direction
        directional = mix(directional, clamp(dot(normalForLighting, u_lightpos_globe), 0.0, 1.0), u_projection_transition);
    #endif

    // Adjust directional so that
    // the range of values for highlight/shading is narrower
    // with lower light intensity
    // and with lighter/brighter surface colors
    directional = mix((1.0 - u_lightintensity), max((1.0 - colorvalue + u_lightintensity), 1.0), directional);

    // Add gradient along z axis of side surfaces
    if (normal.y != 0.0) {
        // This avoids another branching statement, but multiplies by a constant of 0.84 if no vertical gradient,
        // and otherwise calculates the gradient based on base + height
        directional *= (
            (1.0 - u_vertical_gradient) +
            (u_vertical_gradient * clamp((t + gradient_base) * pow(gradient_height / 150.0, 0.5), mix(0.7, 0.98, 1.0 - u_lightintensity), 1.0)));
    }

    // Assign final color based on surface + ambient light color, diffuse light directional, and light color
    // with lower bounds adjusted to hue of light
    // so that shading is tinted with the complementary (opposite) color to the light color
    v_color.r += clamp(color.r * directional * u_lightcolor.r, mix(0.0, 0.3, 1.0 - u_lightcolor.r), 1.0);
    v_color.g += clamp(color.g * directional * u_lightcolor.g, mix(0.0, 0.3, 1.0 - u_lightcolor.g), 1.0);
    v_color.b += clamp(color.b * directional * u_lightcolor.b, mix(0.0, 0.3, 1.0 - u_lightcolor.b), 1.0);
    v_color *= u_opacity;
    #endif
}
