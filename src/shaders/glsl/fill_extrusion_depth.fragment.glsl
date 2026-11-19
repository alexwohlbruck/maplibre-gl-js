#ifdef LIGHT
in highp vec3 v_lit;
#endif

void main() {
    fragColor = vec4(1.0);
    #ifdef LIGHT
    // What the building spills on the ground, for the lamplight's alpha.
    fragColor = vec4(0.0, 0.0, 0.0, clamp(wall_light(v_lit.y, v_lit.x, v_lit.z), 0.0, 1.0));
    #endif
}
