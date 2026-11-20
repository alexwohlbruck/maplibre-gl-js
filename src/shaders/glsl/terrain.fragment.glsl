uniform sampler2D u_texture;
uniform vec4 u_fog_color;
uniform vec4 u_horizon_color;
uniform float u_fog_ground_blend;
uniform float u_fog_ground_blend_opacity;
uniform float u_horizon_fog_blend;
uniform bool u_is_globe_mode;

in vec2 v_texture_pos;
in float v_fog_depth;
in float v_relief;

#ifdef SHADING
in highp vec4 v_sun;
in highp vec2 v_occlusion;
#endif

const float gamma = 2.2;

vec4 gammaToLinear(vec4 color) {
    return pow(color, vec4(gamma));
}

vec4 linearToGamma(vec4 color) {
    return pow(color, vec4(1.0 / gamma));
}

void main() {
    vec4 surface_color = texture(u_texture, vec2(v_texture_pos.x, 1.0 - v_texture_pos.y));
    surface_color.rgb *= v_relief;
    #ifdef SHADING
    // Laid over each drape as it would be over them all: the drapes are premultiplied.
    vec4 shade = ground_shade(v_sun, v_occlusion);
    surface_color.rgb = surface_color.rgb * (1.0 - shade.a) + shade.rgb * surface_color.a;
    #endif

    // Skip fog blending in globe mode or when fog opacity is zero
    if (!u_is_globe_mode && u_fog_ground_blend_opacity > 0.0 && v_fog_depth > u_fog_ground_blend) {
        vec4 surface_color_linear = gammaToLinear(surface_color);
        float blend_color = smoothstep(0.0, 1.0, max((v_fog_depth - u_horizon_fog_blend) / (1.0 - u_horizon_fog_blend), 0.0));
        vec4 fog_horizon_color_linear = mix(gammaToLinear(u_fog_color), gammaToLinear(u_horizon_color), blend_color);
        float factor_fog = max(v_fog_depth - u_fog_ground_blend, 0.0) / (1.0 - u_fog_ground_blend);
        fragColor = linearToGamma(mix(surface_color_linear, fog_horizon_color_linear, pow(factor_fog, 2.0) * u_fog_ground_blend_opacity));
    } else {
        fragColor = surface_color;
    }
    // The draped ground carries flat lines, which cannot fade on their own: the whole surface hazes into the fog instead.
    fragColor = mix(u_fog_color, fragColor, horizon_fade(1.0 / gl_FragCoord.w));
}
