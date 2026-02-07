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
  "cwavasape.effects": true, // Master GPU effects toggle
  "cwavasape.effects.sobel": true, // Edge detection effect
  "cwavasape.effects.blur": true, // Gaussian blur effect
  "cwavasape.effects.regionPaint": true, // Region paint / luminance banding
  "cwavasape.effects.snap": true, // Instant snap toggle
  "cwavasape.effects.overlay": true, // Overlay opacity control

  // cwavasape audio
  "cwavasape.audio": true, // Scroll-triggered audio sampler
} as const satisfies Record<string, boolean>;

export type FeatureFlag = keyof typeof features;

export function isEnabled(flag: FeatureFlag): boolean {
  return features[flag];
}

export function isDisabled(flag: FeatureFlag): boolean {
  return !features[flag];
}
