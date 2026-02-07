import { isEnabled } from "@avoid.quest/shared";
import type { Container, Filter } from "pixi.js";
import type { AnalysisEffectsSettings } from "@/lib/collections/settings";
import { REGION_PAINT_PALETTES } from "@/lib/const";
import {
  type GaussianBlurFilters,
  gaussianBlurFactory,
} from "../filters/gaussian-blur-filter";
import { regionPaintFactory } from "../filters/region-paint-filter";
import { sobelEdgeFactory } from "../filters/sobel-edge-filter";

type ActiveFilters = {
  sobel: Filter | null;
  blur: GaussianBlurFilters | null;
  regionPaint: Filter | null;
};

/**
 * Manages analysis effect filters for a container or sprite
 * Handles filter creation, updates, and cleanup
 */
export class EffectPipeline {
  private activeFilters: ActiveFilters = {
    sobel: null,
    blur: null,
    regionPaint: null,
  };

  private target: Container | null = null;

  /**
   * Attach pipeline to a container or sprite
   */
  attach(target: Container): void {
    this.target = target;
  }

  /**
   * Detach pipeline and clear all filters
   */
  detach(): void {
    this.clear();
    this.target = null;
  }

  /**
   * Update filters based on current settings
   * Creates filters if needed, updates uniforms if already created
   */
  update(settings: AnalysisEffectsSettings): void {
    if (!this.target) {
      return;
    }

    const filters: Filter[] = [];

    // Sobel Edge Detection - check feature flag
    if (settings.sobel.enabled && isEnabled("cwavasape.effects.sobel")) {
      if (this.activeFilters.sobel) {
        sobelEdgeFactory.updateUniforms(this.activeFilters.sobel, {
          threshold: settings.sobel.threshold,
          intensity: settings.sobel.intensity,
          overlayOpacity: settings.overlayOpacity,
        });
      } else {
        this.activeFilters.sobel = sobelEdgeFactory.create({
          threshold: settings.sobel.threshold,
          intensity: settings.sobel.intensity,
          overlayOpacity: settings.overlayOpacity,
        });
      }
      filters.push(this.activeFilters.sobel);
    } else {
      this.activeFilters.sobel = null;
    }

    // Gaussian Blur - check feature flag
    if (settings.blur.enabled && isEnabled("cwavasape.effects.blur")) {
      if (this.activeFilters.blur) {
        gaussianBlurFactory.updateUniforms(this.activeFilters.blur, {
          radius: settings.blur.radius,
        });
      } else {
        this.activeFilters.blur = gaussianBlurFactory.create({
          radius: settings.blur.radius,
        });
      }
      filters.push(...gaussianBlurFactory.toArray(this.activeFilters.blur));
    } else {
      this.activeFilters.blur = null;
    }

    // Region Paint - check feature flag
    if (
      settings.regionPaint.enabled &&
      isEnabled("cwavasape.effects.regionPaint")
    ) {
      const palette =
        REGION_PAINT_PALETTES[settings.regionPaint.paletteId]?.colors;

      if (this.activeFilters.regionPaint) {
        regionPaintFactory.updateUniforms(this.activeFilters.regionPaint, {
          bandCount: settings.regionPaint.bandCount,
          threshold: settings.regionPaint.threshold,
          overlayOpacity: settings.overlayOpacity,
          palette,
        });
      } else {
        this.activeFilters.regionPaint = regionPaintFactory.create({
          bandCount: settings.regionPaint.bandCount,
          threshold: settings.regionPaint.threshold,
          overlayOpacity: settings.overlayOpacity,
          palette,
        });
      }
      filters.push(this.activeFilters.regionPaint);
    } else {
      this.activeFilters.regionPaint = null;
    }

    // Apply filters to target
    this.target.filters = filters.length > 0 ? filters : null;
  }

  /**
   * Clear all filters from target
   */
  clear(): void {
    if (this.target) {
      this.target.filters = null;
    }
    this.activeFilters = {
      sobel: null,
      blur: null,
      regionPaint: null,
    };
  }

  /**
   * Check if any effect is currently active
   */
  hasActiveEffects(): boolean {
    return (
      this.activeFilters.sobel !== null ||
      this.activeFilters.blur !== null ||
      this.activeFilters.regionPaint !== null
    );
  }
}
