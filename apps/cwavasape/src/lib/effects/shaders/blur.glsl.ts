export { VERTEX_SHADER as BLUR_VERTEX } from "./common.glsl";

/**
 * Horizontal Gaussian blur fragment shader
 *
 * Uniforms:
 * - uRadius: Blur radius in pixels (1-20)
 */
export const BLUR_HORIZONTAL_FRAGMENT = /* glsl */ `
  precision highp float;

  in vec2 vTextureCoord;
  uniform sampler2D uTexture;
  uniform vec4 uInputSize;
  uniform float uRadius;

  void main(void) {
    vec2 texelSize = 1.0 / uInputSize.xy;
    vec2 uv = vTextureCoord;

    vec4 color = vec4(0.0);
    float total = 0.0;

    // Gaussian weights approximation using sigma = radius/3
    float sigma = max(uRadius / 3.0, 0.001);
    float twoSigmaSq = 2.0 * sigma * sigma;

    for (float i = -20.0; i <= 20.0; i += 1.0) {
      if (abs(i) > uRadius) continue;

      float weight = exp(-(i * i) / twoSigmaSq);
      vec2 offset = vec2(i * texelSize.x, 0.0);
      color += texture2D(uTexture, uv + offset) * weight;
      total += weight;
    }

    gl_FragColor = color / total;
  }
`;

/**
 * Vertical Gaussian blur fragment shader
 *
 * Uniforms:
 * - uRadius: Blur radius in pixels (1-20)
 */
export const BLUR_VERTICAL_FRAGMENT = /* glsl */ `
  precision highp float;

  in vec2 vTextureCoord;
  uniform sampler2D uTexture;
  uniform vec4 uInputSize;
  uniform float uRadius;

  void main(void) {
    vec2 texelSize = 1.0 / uInputSize.xy;
    vec2 uv = vTextureCoord;

    vec4 color = vec4(0.0);
    float total = 0.0;

    // Gaussian weights approximation using sigma = radius/3
    float sigma = max(uRadius / 3.0, 0.001);
    float twoSigmaSq = 2.0 * sigma * sigma;

    for (float i = -20.0; i <= 20.0; i += 1.0) {
      if (abs(i) > uRadius) continue;

      float weight = exp(-(i * i) / twoSigmaSq);
      vec2 offset = vec2(0.0, i * texelSize.y);
      color += texture2D(uTexture, uv + offset) * weight;
      total += weight;
    }

    gl_FragColor = color / total;
  }
`;
