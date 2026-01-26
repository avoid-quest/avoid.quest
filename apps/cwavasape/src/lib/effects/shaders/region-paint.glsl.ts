import { LUMINANCE_FUNCTION } from "./common.glsl";

export { VERTEX_SHADER as REGION_PAINT_VERTEX } from "./common.glsl";

/**
 * Region paint fragment shader
 *
 * Creates a "paint by numbers" effect by quantizing luminance
 * into discrete bands and colorizing each band with a palette color.
 *
 * Uniforms:
 * - uBandCount: Number of luminance bands (2-8)
 * - uThreshold: Edge smoothing between bands (0-0.1)
 * - uOverlayOpacity: Blend factor with original (0-1)
 * - uPalette: Array of 8 RGB colors for each band
 */
export const REGION_PAINT_FRAGMENT = /* glsl */ `
  precision highp float;

  in vec2 vTextureCoord;
  uniform sampler2D uTexture;
  uniform float uBandCount;
  uniform float uThreshold;
  uniform float uOverlayOpacity;
  uniform vec3 uPalette[8];

  ${LUMINANCE_FUNCTION}

  void main(void) {
    vec4 original = texture2D(uTexture, vTextureCoord);
    float lum = luminance(original.rgb);

    // Quantize luminance to band index
    float bandSize = 1.0 / uBandCount;
    float bandIndex = floor(lum / bandSize);
    bandIndex = clamp(bandIndex, 0.0, uBandCount - 1.0);

    // Get palette color for this band
    int idx = int(bandIndex);
    vec3 bandColor;
    if (idx == 0) bandColor = uPalette[0];
    else if (idx == 1) bandColor = uPalette[1];
    else if (idx == 2) bandColor = uPalette[2];
    else if (idx == 3) bandColor = uPalette[3];
    else if (idx == 4) bandColor = uPalette[4];
    else if (idx == 5) bandColor = uPalette[5];
    else if (idx == 6) bandColor = uPalette[6];
    else bandColor = uPalette[7];

    // Blend with original based on opacity
    vec3 result = mix(original.rgb, bandColor, uOverlayOpacity);

    gl_FragColor = vec4(result, original.a);
  }
`;
