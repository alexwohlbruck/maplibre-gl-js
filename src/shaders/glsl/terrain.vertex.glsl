layout(location = 0) in vec3 a_pos3d;

uniform mat4 u_fog_matrix;
uniform float u_ele_delta;

out vec2 v_texture_pos;
out float v_fog_depth;

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
    gl_Position = projectTileFor3D(a_pos3d.xy, ele - ele_delta);
    vec4 pos = u_fog_matrix * vec4(a_pos3d.xy, ele, 1.0);
    v_fog_depth = pos.z / pos.w * 0.5 + 0.5;
    #ifdef SHADING
    v_sun = u_sun_matrix * vec4(a_pos3d.xy, ele, 1.0);
    v_occlusion = (u_occlusion_matrix * vec4(a_pos3d.xy, 0.0, 1.0)).xy;
    #endif
}