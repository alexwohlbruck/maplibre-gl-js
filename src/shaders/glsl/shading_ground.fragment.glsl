in highp vec4 v_sun;
in highp vec2 v_occlusion;

void main() {
    fragColor = ground_shade(v_sun, v_occlusion);
}
