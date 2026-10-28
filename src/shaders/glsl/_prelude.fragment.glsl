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
uniform highp sampler2D u_depth;

// Keeps an elevated line's fragment to its own tile, whose neighbours draw the rest of the line from their buffers.
// Underground it takes the depth just in front of the terrain over it: what stands on the ground hides it, the ground does not.
void elevated_line_fragment(highp vec2 tile_pos, float lift) {
    if (tile_pos.x < 0.0 || tile_pos.y < 0.0 || tile_pos.x > 8192.0 || tile_pos.y > 8192.0) discard;
    if (lift < 0.0) {
        highp vec4 packed = texture(u_depth, gl_FragCoord.xy / (u_viewport_size * u_device_pixel_ratio));
        highp float terrain = dot(packed, vec4(1.0 / 16777216.0, 1.0 / 65536.0, 1.0 / 256.0, 1.0));
        gl_FragDepth = min(gl_FragCoord.z, gl_DepthRange.near + gl_DepthRange.diff * ((terrain - 0.0001) * 0.5 + 0.5));
    } else {
        gl_FragDepth = gl_FragCoord.z;
    }
}
#endif
