import { LUMINANCE_FUNCTION, VERTEX_SHADER } from "./common.glsl";

export { VERTEX_SHADER as SOBEL_VERTEX };

/**
 * Sobel edge detection fragment shader
 *
 * Detects edges using the Sobel operator which computes
 * horizontal and vertical gradients via convolution kernels.
 *
 * Uniforms:
 * - uThreshold: Edge detection sensitivity (0-1, lower = more edges)
 * - uIntensity: Edge brightness multiplier (0-3)
 * - uOverlayOpacity: Blend factor with original image (0-1)
 */
export const SOBEL_FRAGMENT = /* glsl */ `
  precision highp float;

  in vec2 vTextureCoord;
  uniform sampler2D uTexture;
  uniform vec4 uInputSize;
  uniform float uThreshold;
  uniform float uIntensity;
  uniform float uOverlayOpacity;

  ${LUMINANCE_FUNCTION}

  void main(void) {
    vec2 texelSize = 1.0 / uInputSize.xy;
    vec2 uv = vTextureCoord;

    // Sample 3x3 neighborhood
    float tl = luminance(texture2D(uTexture, uv + vec2(-texelSize.x, -texelSize.y)).rgb);
    float t  = luminance(texture2D(uTexture, uv + vec2(0.0, -texelSize.y)).rgb);
    float tr = luminance(texture2D(uTexture, uv + vec2(texelSize.x, -texelSize.y)).rgb);
    float l  = luminance(texture2D(uTexture, uv + vec2(-texelSize.x, 0.0)).rgb);
    float r  = luminance(texture2D(uTexture, uv + vec2(texelSize.x, 0.0)).rgb);
    float bl = luminance(texture2D(uTexture, uv + vec2(-texelSize.x, texelSize.y)).rgb);
    float b  = luminance(texture2D(uTexture, uv + vec2(0.0, texelSize.y)).rgb);
    float br = luminance(texture2D(uTexture, uv + vec2(texelSize.x, texelSize.y)).rgb);

    // Sobel kernels
    float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
    float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;

    // Gradient magnitude
    float edge = sqrt(gx*gx + gy*gy);

    // Apply threshold and intensity
    edge = smoothstep(uThreshold, uThreshold + 0.1, edge) * uIntensity;

    // Get original color
    vec4 original = texture2D(uTexture, uv);

    // Blend edge overlay with original
    vec3 edgeColor = vec3(edge);
    vec3 result = mix(original.rgb, edgeColor, uOverlayOpacity);

    gl_FragColor = vec4(result, original.a);
  }
`;
