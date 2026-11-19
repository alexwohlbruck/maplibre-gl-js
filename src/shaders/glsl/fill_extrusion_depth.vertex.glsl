layout(location = 0) in vec2 a_pos;
layout(location = 1) in ivec4 a_normal_ed;

#ifdef TERRAIN3D
    layout(location = 2) in float a_anchor_elevation;
#endif

#pragma maplibre: define highp float base
#pragma maplibre: define highp float height

// An extrusion as the map's shading sees it from the sun, or from overhead: where it stands, and nothing else.
void main() {
    #pragma maplibre: initialize highp float base
    #pragma maplibre: initialize highp float height

    if (height < 0.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }

    #ifdef TERRAIN3D
        float ground = a_anchor_elevation;
    #else
        float ground = 0.0;
    #endif
    float elevation = ((a_normal_ed.x & 1) > 0 ? max(0.0, height) : max(0.0, base)) + ground;
    gl_Position = u_projection_matrix * vec4(a_pos, elevation, 1.0);
}
