/**
 * Feature flags for the monorepo.
 *
 * Usage:
 *   import { isEnabled } from '@avoid.quest/shared'
 *
 *   if (isEnabled('cwavasape.effects.sobel')) {
 *     // render sobel effect controls
 *   }
 */

export const features = {
  // cwavasape effects
  "cwavasape.effects": false, // Master GPU effects toggle
  "cwavasape.effects.sobel": false, // Edge detection effect
  "cwavasape.effects.blur": false, // Gaussian blur effect
  "cwavasape.effects.regionPaint": false, // Region paint / luminance banding
  "cwavasape.effects.snap": false, // Instant snap toggle
  "cwavasape.effects.overlay": false, // Overlay opacity control
} as const satisfies Record<string, boolean>;

export type FeatureFlag = keyof typeof features;

export function isEnabled(flag: FeatureFlag): boolean {
  return features[flag];
}

export function isDisabled(flag: FeatureFlag): boolean {
  return !features[flag];
}
