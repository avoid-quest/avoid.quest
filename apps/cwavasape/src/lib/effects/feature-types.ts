/**
 * RGB color tuple (0-255 per channel)
 */
export type RGBColor = [number, number, number];

/**
 * Features extracted from an image for smart transitions
 */
export type ImageFeatures = {
  /** Top 3 dominant colors in the image */
  dominantColors: [RGBColor, RGBColor, RGBColor];
  /** Edge density from 0 (smooth) to 1 (busy) */
  edgeDensity: number;
  /** Center of mass of luminance, normalized 0-1 */
  centerOfMass: { x: number; y: number };
  /** Sharpness from 0 (blurry) to 1 (sharp) */
  sharpness: number;
  /** 16-bin luminance histogram */
  luminanceHistogram: Float32Array;
  /** Average luminance 0-1 */
  averageLuminance: number;
  /** Dominant hue and saturation */
  dominantHue: { hue: number; saturation: number };
};

/**
 * Comparison metrics between two images
 */
export type FeatureComparison = {
  /** How similar the dominant colors are (0-1, higher = more similar) */
  colorSimilarity: number;
  /** Distance between centers of mass (0-1, higher = further apart) */
  centerDistance: number;
  /** Difference in edge density (0-1) */
  edgeDifference: number;
  /** Difference in average luminance (0-1) */
  luminanceDifference: number;
  /** Difference in sharpness (0-1) */
  sharpnessDifference: number;
};

/**
 * Parameters for transition based on feature comparison
 */
export type TransitionParams = {
  /** Duration multiplier (1 = normal, <1 = faster, >1 = slower) */
  durationMultiplier: number;
  /** Easing curve name */
  easing: "linear" | "ease-in" | "ease-out" | "ease-in-out";
};
