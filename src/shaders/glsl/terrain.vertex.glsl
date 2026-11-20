layout(location = 0) in vec3 a_pos3d;

uniform mat4 u_fog_matrix;
uniform float u_ele_delta;

out vec2 v_texture_pos;
out float v_fog_depth;

// The light's direction in tile space and the shading's strength (0 for none); the metres a tile unit spans and the light's intensity.
uniform highp vec4 u_relief;
uniform highp vec2 u_relief_scale;
out float v_relief;

// The light on the slope here against the light on flat ground, as the extrusions are lit, by the shading's strength.
float relief_shade(vec2 pos) {
    const float step = 64.0;
    highp float dx = get_elevation(pos + vec2(step, 0.0)) - get_elevation(pos - vec2(step, 0.0));
    highp float dy = get_elevation(pos + vec2(0.0, step)) - get_elevation(pos - vec2(0.0, step));
    highp vec3 n = normalize(vec3(-dx, -dy, 2.0 * step * u_relief_scale.x));
    float floor_light = 1.0 - u_relief_scale.y;
    float slope = mix(floor_light, 1.0, clamp(dot(n, u_relief.xyz), 0.0, 1.0));
    float level = mix(floor_light, 1.0, clamp(u_relief.z, 0.0, 1.0));
    return mix(1.0, clamp(slope / max(level, 0.05), 0.35, 1.4), u_relief.w);
}

#ifdef SHADING
uniform mat4 u_sun_matrix;
uniform mat4 u_occlusion_matrix;
out highp vec4 v_sun;
out highp vec2 v_occlusion;
#endif

void main() {
    float ele = get_elevation(a_pos3d.xy);
    float ele_delta = a_pos3d.z == 1.0 ? u_ele_delta : 0.0;
    v_texture_pos = a_pos3d.xy / 8192.0;
    v_relief = u_relief.w > 0.0 ? relief_shade(a_pos3d.xy) : 1.0;
    gl_Position = projectTileFor3D(a_pos3d.xy, ele - ele_delta);
    vec4 pos = u_fog_matrix * vec4(a_pos3d.xy, ele, 1.0);
    v_fog_depth = pos.z / pos.w * 0.5 + 0.5;
    #ifdef SHADING
    v_sun = u_sun_matrix * vec4(a_pos3d.xy, ele, 1.0);
    v_occlusion = (u_occlusion_matrix * vec4(a_pos3d.xy, 0.0, 1.0)).xy;
    #endif
}