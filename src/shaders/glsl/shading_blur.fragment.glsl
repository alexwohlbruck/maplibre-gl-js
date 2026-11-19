uniform sampler2D u_image;
// The step between taps in uv, along the axis blurred.
uniform highp vec2 u_step;
// The blur's sigma in steps, and the mip level read.
uniform highp vec2 u_blur;

in highp vec2 v_uv;

// One axis of the gaussian that turns the footprints seen from overhead into ground occlusion.
void main() {
    highp float sum = 0.0;
    highp float weight = 0.0;
    for (int i = -8; i <= 8; i++) {
        highp float w = exp(-0.5 * float(i * i) / (u_blur.x * u_blur.x));
        sum += w * textureLod(u_image, v_uv + float(i) * u_step, u_blur.y).r;
        weight += w;
    }
    fragColor = vec4(sum / weight);
}
