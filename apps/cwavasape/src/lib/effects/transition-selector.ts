import type {
  FeatureComparison,
  ImageFeatures,
  RGBColor,
  TransitionParams,
} from "./feature-types";

/**
 * Compare features between two images
 */
export function compareFeatures(
  from: ImageFeatures,
  to: ImageFeatures
): FeatureComparison {
  return {
    colorSimilarity: computeColorSimilarity(
      from.dominantColors,
      to.dominantColors
    ),
    centerDistance: computeCenterDistance(from.centerOfMass, to.centerOfMass),
    edgeDifference: Math.abs(from.edgeDensity - to.edgeDensity),
    luminanceDifference: Math.abs(from.averageLuminance - to.averageLuminance),
    sharpnessDifference: Math.abs(from.sharpness - to.sharpness),
  };
}

/**
 * Select transition parameters based on feature comparison
 */
export function selectTransitionParams(
  comparison: FeatureComparison
): TransitionParams {
  // Base duration multiplier
  let durationMultiplier = 1.0;

  // Similar colors = faster transition (images blend well)
  if (comparison.colorSimilarity > 0.8) {
    durationMultiplier *= 0.8;
  }

  // High center distance = slower transition (more visual change)
  if (comparison.centerDistance > 0.5) {
    durationMultiplier *= 1.2;
  }

  // High luminance difference = slightly slower
  if (comparison.luminanceDifference > 0.3) {
    durationMultiplier *= 1.1;
  }

  // High edge difference = slightly slower (complexity change)
  if (comparison.edgeDifference > 0.3) {
    durationMultiplier *= 1.1;
  }

  // Clamp to reasonable range
  durationMultiplier = Math.max(0.5, Math.min(2.0, durationMultiplier));

  // Select easing based on image characteristics
  let easing: TransitionParams["easing"] = "ease-in-out";

  // High luminance difference = ease-out (settle into new image)
  if (comparison.luminanceDifference > 0.4) {
    easing = "ease-out";
  }
  // Very similar images = linear
  else if (
    comparison.colorSimilarity > 0.9 &&
    comparison.centerDistance < 0.2
  ) {
    easing = "linear";
  }
  // High center distance = ease-in-out (emphasize transition)
  else if (comparison.centerDistance > 0.6) {
    easing = "ease-in-out";
  }

  return { durationMultiplier, easing };
}

/**
 * Compute color similarity between two sets of dominant colors
 */
function computeColorSimilarity(
  a: [RGBColor, RGBColor, RGBColor],
  b: [RGBColor, RGBColor, RGBColor]
): number {
  // Compare each color to best match in other set
  let totalSimilarity = 0;

  for (const colorA of a) {
    let bestMatch = 0;
    for (const colorB of b) {
      const similarity = 1 - colorDistanceNormalized(colorA, colorB);
      bestMatch = Math.max(bestMatch, similarity);
    }
    totalSimilarity += bestMatch;
  }

  return totalSimilarity / 3;
}

/**
 * Normalized color distance (0 = same, 1 = max different)
 */
function colorDistanceNormalized(a: RGBColor, b: RGBColor): number {
  const dr = (a[0] - b[0]) / 255;
  const dg = (a[1] - b[1]) / 255;
  const db = (a[2] - b[2]) / 255;
  // Max distance is sqrt(3) for black-white
  return Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3);
}

/**
 * Compute distance between two centers of mass
 */
function computeCenterDistance(
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  // Max distance is sqrt(2) for diagonal corners
  return Math.sqrt(dx * dx + dy * dy) / Math.sqrt(2);
}
