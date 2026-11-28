#ifdef GL_ES
precision mediump float;
#else

#if !defined(lowp)
#define lowp
#endif

#if !defined(mediump)
#define mediump
#endif

#if !defined(highp)
#define highp
#endif

#endif

out highp vec4 fragColor;

layout(std140) uniform ProjectionUBO {
    highp mat4 u_projection_matrix;
    highp mat4 u_projection_fallback_matrix;
    highp vec4 u_projection_tile_mercator_coords;
    highp vec4 u_projection_clipping_plane;
    highp vec4 u_projection_tile_origin;
    highp vec2 u_projection_tile_origin_position;
    highp float u_projection_transition;
    highp int u_projection_clip_antimeridian;
};
layout(std140) uniform FrameUBO {
    highp vec2 u_units_to_pixels;
    highp vec2 u_world_size;
    highp float u_camera_to_center_distance;
    highp float u_symbol_fade_change;
    highp float u_aspect_ratio;
    highp float u_device_pixel_ratio;
    highp vec2 u_viewport_size;
    highp vec2 u_pixel_extrude_scale;
    highp float u_pitch;
};

#ifdef LINE_ELEVATION
// Keeps an elevated line's fragment to its own tile, whose neighbours draw the rest of the line from their buffers,
// and to the side of the terrain the pass draws.
void elevated_line_fragment(highp vec2 tile_pos, float lift) {
    if (tile_pos.x < 0.0 || tile_pos.y < 0.0 || tile_pos.x > 8192.0 || tile_pos.y > 8192.0) discard;
    #ifdef LINE_UNDERGROUND
        if (lift >= 0.0) discard;
    #endif
    #ifdef LINE_OVERGROUND
        if (lift < 0.0) discard;
    #endif
}
#endif

#ifdef TILE_FADE
// How far a tile's content has faded in since it first drew, 0-1; see tile_fade.ts.
uniform lowp float u_tile_fade;
#endif

#ifdef HORIZON_FADE
// 1 near the camera, easing to 0 between 2.5 and 5 times the map centre's distance, which only steep pitches reach.
float horizon_fade(highp float depth) {
    return 1.0 - smoothstep(2.5, 5.0, depth / u_camera_to_center_distance);
}
#endif

#ifdef SHADING
// The map's shading (render/shading.ts): the sun's shadow map and the ground occlusion, read alike by every receiver.
uniform highp sampler2DShadow u_sun_shadow;
// How much of the sun's shadow shows (0 with no sun), a texel of its map in uv, and the depth a texel spans.
uniform highp vec3 u_sun;
uniform sampler2D u_occlusion;
// The ground occlusion's strength (0 with none) and the power that narrows its reach.
uniform highp vec2 u_occlusion_strength;
// The ground's slope to the light, and how dark a shadow lies on it.
uniform highp vec2 u_ground;
uniform vec3 u_shadow_color;
// The lamplight seen from overhead, at the occlusion's coordinates: rgb what lamps throw, a what lit buildings spill.
uniform sampler2D u_lights;
// The spill's colour at the light's strength, and that strength: 0 by day.
uniform highp vec4 u_light;

// 0 lit to 1 in the sun's shadow, for a point in the sun's clip space on a surface at `slope` to the light.
float sun_shade(highp vec4 p, highp float slope) {
    if (u_sun.x <= 0.0) return 0.0;
    highp vec3 c = p.xyz / p.w * 0.5 + 0.5;
    highp vec2 edge = abs(c.xy * 2.0 - 1.0);
    highp float reach = max(edge.x, edge.y);
    if (reach >= 1.0 || c.z > 1.0) return 0.0;
    highp float z = c.z - (0.5 + 1.0 * min(slope, 4.0)) * u_sun.z;
    highp float d = 0.75 * u_sun.y;
    // Four filtered taps: a soft edge about three texels wide. Lod, as receivers sample inside a branch.
    float lit = textureLod(u_sun_shadow, vec3(c.xy + vec2(-d, -d), z), 0.0)
        + textureLod(u_sun_shadow, vec3(c.xy + vec2(d, -d), z), 0.0)
        + textureLod(u_sun_shadow, vec3(c.xy + vec2(-d, d), z), 0.0)
        + textureLod(u_sun_shadow, vec3(c.xy + vec2(d, d), z), 0.0);
    return u_sun.x * (1.0 - lit * 0.25) * (1.0 - smoothstep(0.9, 1.0, reach));
}

// How much the buildings around a point on the ground close it in, 0 to the occlusion's strength.
float ground_occlusion(highp vec2 uv) {
    if (u_occlusion_strength.x <= 0.0) return 0.0;
    highp vec2 edge = abs(uv * 2.0 - 1.0);
    highp float reach = max(edge.x, edge.y);
    if (reach >= 1.0) return 0.0;
    float near = clamp(2.0 * textureLod(u_occlusion, uv, 0.0).r, 0.0, 1.0);
    return u_occlusion_strength.x * pow(near, u_occlusion_strength.y) * (1.0 - smoothstep(0.8, 1.0, reach));
}

// The lamplight at a point of the ground: rgb from lamps, at its strength, and a the share lit buildings spill.
vec4 lamp_light(highp vec2 uv) {
    if (u_light.a <= 0.0) return vec4(0.0);
    highp vec2 edge = abs(uv * 2.0 - 1.0);
    highp float reach = max(edge.x, edge.y);
    if (reach >= 1.0) return vec4(0.0);
    vec4 light = textureLod(u_lights, uv, 0.0) * (1.0 - smoothstep(0.8, 1.0, reach));
    return vec4(light.rgb * u_light.a, light.a);
}

// What the shading lays on the ground at a point, premultiplied: the shadow's tint and all it covers, and the
// lamplight added over them.
vec4 ground_shade(highp vec4 sun, highp vec2 occlusion_uv) {
    float shadow = sun_shade(sun, u_ground.x) * u_ground.y;
    float occlusion = ground_occlusion(occlusion_uv);
    vec4 light = lamp_light(occlusion_uv);
    return vec4(u_shadow_color * shadow + light.rgb + u_light.rgb * light.a, 1.0 - (1.0 - shadow) * (1.0 - occlusion));
}
#endif
