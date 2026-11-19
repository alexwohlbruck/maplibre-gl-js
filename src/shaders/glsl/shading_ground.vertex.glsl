layout(location = 0) in vec2 a_pos;

uniform mat4 u_matrix;
uniform mat4 u_sun_matrix;
uniform mat4 u_occlusion_matrix;

out highp vec4 v_sun;
out highp vec2 v_occlusion;

// The flat ground the shading reaches, as one quad about the view.
void main() {
    vec4 p = vec4(a_pos, 0.0, 1.0);
    gl_Position = u_matrix * p;
    v_sun = u_sun_matrix * p;
    v_occlusion = (u_occlusion_matrix * p).xy;
}
