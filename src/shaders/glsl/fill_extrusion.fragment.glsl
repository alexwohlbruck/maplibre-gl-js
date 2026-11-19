in vec4 v_color;

#ifdef SHADING
uniform float u_shade_edge;
in vec3 v_ambient;
in float v_facing;
in highp vec4 v_sun;
in float v_dark;
in vec3 v_edge;
in highp vec3 v_wall;
in highp vec2 v_facade;
in highp vec2 v_light;
uniform float u_light_height;
#endif

void main() {
    fragColor = v_color;

    #ifdef SHADING
    float edge = v_edge.x < 0.0 ? 0.0 : v_edge.z * (1.0 - smoothstep(0.0, v_edge.y, 1.0 - v_edge.x));
    // A face in another's shadow takes the light of a face turned from the sun.
    float facing = clamp(v_facing, 0.0, 1.0);
    float shade = facing > 0.0 ? sun_shade(v_sun, sqrt(1.0 - facing * facing) / max(facing, 0.2)) : 0.0;
    vec3 color = mix(v_color.rgb, v_ambient * 0.9, shade) * (1.0 - v_dark);
    #ifdef SHADING_WALL
    if (v_wall.z > 0.0) color = shade_wall(color, v_wall, v_facade.y, v_facade.x);
    #endif
    color *= 1.0 - u_shade_edge * edge;
    // Lamplight reaches a wall near the ground, in the wall's own colour.
    color += (color + 0.12) * lamp_light(v_light).rgb * exp(-max(v_wall.y, 0.0) / u_light_height);
    fragColor = vec4(color * v_color.a, v_color.a);
    #endif

    #ifdef OVERDRAW_INSPECTOR
        fragColor = vec4(1.0);
    #endif
}
