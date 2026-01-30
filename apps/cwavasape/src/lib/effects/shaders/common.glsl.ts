/**
 * Common GLSL shader code shared across analysis effects
 */

/**
 * Standard vertex shader for PixiJS v8 filters
 * Uses the correct filter coordinate system with uOutputFrame/uOutputTexture/uInputSize
 */
export const VERTEX_SHADER = /* glsl */ `
  precision highp float;

  in vec2 aPosition;
  out vec2 vTextureCoord;

  uniform vec4 uInputSize;
  uniform vec4 uOutputFrame;
  uniform vec4 uOutputTexture;

  vec4 filterVertexPosition(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
  }

  vec2 filterTextureCoord(void) {
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
  }

  void main(void) {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
  }
`;

/**
 * GLSL function to compute luminance from RGB
 * Uses standard coefficients for human perception
 */
export const LUMINANCE_FUNCTION = /* glsl */ `
  float luminance(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
  }
`;

/**
 * GLSL function to convert RGB to HSL
 */
export const RGB_TO_HSL_FUNCTION = /* glsl */ `
  vec3 rgbToHsl(vec3 color) {
    float maxC = max(max(color.r, color.g), color.b);
    float minC = min(min(color.r, color.g), color.b);
    float l = (maxC + minC) * 0.5;

    if (maxC == minC) {
      return vec3(0.0, 0.0, l);
    }

    float d = maxC - minC;
    float s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);

    float h;
    if (maxC == color.r) {
      h = (color.g - color.b) / d + (color.g < color.b ? 6.0 : 0.0);
    } else if (maxC == color.g) {
      h = (color.b - color.r) / d + 2.0;
    } else {
      h = (color.r - color.g) / d + 4.0;
    }
    h /= 6.0;

    return vec3(h, s, l);
  }
`;
