import {
  createCollection,
  localStorageCollectionOptions,
} from "@tanstack/react-db";
import { z } from "zod";
import {
  DEFAULT_BLUR_ENABLED,
  DEFAULT_BLUR_RADIUS,
  DEFAULT_EFFECTS_ENABLED,
  DEFAULT_IMAGE_SIZE,
  DEFAULT_OVERLAY_OPACITY,
  DEFAULT_REGION_PAINT_BAND_COUNT,
  DEFAULT_REGION_PAINT_ENABLED,
  DEFAULT_REGION_PAINT_PALETTE_ID,
  DEFAULT_REGION_PAINT_THRESHOLD,
  DEFAULT_SCROLL_SENSITIVITY,
  DEFAULT_SNAP_ENABLED,
  DEFAULT_SOBEL_ENABLED,
  DEFAULT_SOBEL_INTENSITY,
  DEFAULT_SOBEL_THRESHOLD,
  DEFAULT_USERNAME,
} from "../const";

const imageSizeSchema = z.enum(["170x", "236x", "474x", "736x", "orig"]);

const sobelSettingsSchema = z.object({
  enabled: z.boolean().default(DEFAULT_SOBEL_ENABLED),
  threshold: z.number().min(0).max(1).default(DEFAULT_SOBEL_THRESHOLD),
  intensity: z.number().min(0).max(3).default(DEFAULT_SOBEL_INTENSITY),
});

const blurSettingsSchema = z.object({
  enabled: z.boolean().default(DEFAULT_BLUR_ENABLED),
  radius: z.number().min(1).max(20).default(DEFAULT_BLUR_RADIUS),
});

const regionPaintSettingsSchema = z.object({
  enabled: z.boolean().default(DEFAULT_REGION_PAINT_ENABLED),
  threshold: z.number().min(0).max(0.1).default(DEFAULT_REGION_PAINT_THRESHOLD),
  bandCount: z.number().min(2).max(8).default(DEFAULT_REGION_PAINT_BAND_COUNT),
  paletteId: z.string().default(DEFAULT_REGION_PAINT_PALETTE_ID),
});

const analysisEffectsSchema = z.object({
  overlayOpacity: z.number().min(0).max(1).default(DEFAULT_OVERLAY_OPACITY),
  sobel: sobelSettingsSchema.default(() => ({
    enabled: DEFAULT_SOBEL_ENABLED,
    threshold: DEFAULT_SOBEL_THRESHOLD,
    intensity: DEFAULT_SOBEL_INTENSITY,
  })),
  blur: blurSettingsSchema.default(() => ({
    enabled: DEFAULT_BLUR_ENABLED,
    radius: DEFAULT_BLUR_RADIUS,
  })),
  regionPaint: regionPaintSettingsSchema.default(() => ({
    enabled: DEFAULT_REGION_PAINT_ENABLED,
    threshold: DEFAULT_REGION_PAINT_THRESHOLD,
    bandCount: DEFAULT_REGION_PAINT_BAND_COUNT,
    paletteId: DEFAULT_REGION_PAINT_PALETTE_ID,
  })),
});

const settingsSchema = z.object({
  id: z.literal("app-settings"),
  username: z.string().default(DEFAULT_USERNAME),
  imageSize: imageSizeSchema.default(DEFAULT_IMAGE_SIZE),
  scrollSensitivity: z
    .number()
    .min(0.1)
    .max(4.0)
    .default(DEFAULT_SCROLL_SENSITIVITY),
  effectsEnabled: z.boolean().default(DEFAULT_EFFECTS_ENABLED),
  snapEnabled: z.boolean().default(DEFAULT_SNAP_ENABLED),
  analysisEffects: analysisEffectsSchema.default(() => ({
    overlayOpacity: DEFAULT_OVERLAY_OPACITY,
    sobel: {
      enabled: DEFAULT_SOBEL_ENABLED,
      threshold: DEFAULT_SOBEL_THRESHOLD,
      intensity: DEFAULT_SOBEL_INTENSITY,
    },
    blur: {
      enabled: DEFAULT_BLUR_ENABLED,
      radius: DEFAULT_BLUR_RADIUS,
    },
    regionPaint: {
      enabled: DEFAULT_REGION_PAINT_ENABLED,
      threshold: DEFAULT_REGION_PAINT_THRESHOLD,
      bandCount: DEFAULT_REGION_PAINT_BAND_COUNT,
      paletteId: DEFAULT_REGION_PAINT_PALETTE_ID,
    },
  })),
});

export type Settings = z.infer<typeof settingsSchema>;
export type ImageSize = z.infer<typeof imageSizeSchema>;
export type SobelSettings = z.infer<typeof sobelSettingsSchema>;
export type BlurSettings = z.infer<typeof blurSettingsSchema>;
export type RegionPaintSettings = z.infer<typeof regionPaintSettingsSchema>;
export type AnalysisEffectsSettings = z.infer<typeof analysisEffectsSchema>;

const SETTINGS_ID = "app-settings" as const;

export const settingsCollection = createCollection(
  localStorageCollectionOptions({
    id: "cwavasape-settings",
    storageKey: "cwavasape-settings",
    getKey: (item) => item.id,
    schema: settingsSchema,
  })
);

/**
 * Initialize settings with defaults if empty, or migrate existing settings
 */
export async function initializeSettings(): Promise<void> {
  const existing = await settingsCollection.stateWhenReady();

  if (existing.size === 0) {
    settingsCollection.insert({
      id: SETTINGS_ID,
      username: DEFAULT_USERNAME,
      imageSize: DEFAULT_IMAGE_SIZE,
      scrollSensitivity: DEFAULT_SCROLL_SENSITIVITY,
      effectsEnabled: DEFAULT_EFFECTS_ENABLED,
      snapEnabled: DEFAULT_SNAP_ENABLED,
      analysisEffects: {
        overlayOpacity: DEFAULT_OVERLAY_OPACITY,
        sobel: {
          enabled: DEFAULT_SOBEL_ENABLED,
          threshold: DEFAULT_SOBEL_THRESHOLD,
          intensity: DEFAULT_SOBEL_INTENSITY,
        },
        blur: {
          enabled: DEFAULT_BLUR_ENABLED,
          radius: DEFAULT_BLUR_RADIUS,
        },
        regionPaint: {
          enabled: DEFAULT_REGION_PAINT_ENABLED,
          threshold: DEFAULT_REGION_PAINT_THRESHOLD,
          bandCount: DEFAULT_REGION_PAINT_BAND_COUNT,
          paletteId: DEFAULT_REGION_PAINT_PALETTE_ID,
        },
      },
    });
  } else {
    // Migrate existing settings to add new fields
    const settings = existing.get(SETTINGS_ID);
    if (settings) {
      settingsCollection.update(SETTINGS_ID, (draft) => {
        if (draft.scrollSensitivity === undefined) {
          draft.scrollSensitivity = DEFAULT_SCROLL_SENSITIVITY;
        }
        if (draft.effectsEnabled === undefined) {
          draft.effectsEnabled = DEFAULT_EFFECTS_ENABLED;
        }
        if (draft.snapEnabled === undefined) {
          draft.snapEnabled = DEFAULT_SNAP_ENABLED;
        }
        // Migrate analysisEffects
        if (draft.analysisEffects === undefined) {
          draft.analysisEffects = {
            overlayOpacity: DEFAULT_OVERLAY_OPACITY,
            sobel: {
              enabled: DEFAULT_SOBEL_ENABLED,
              threshold: DEFAULT_SOBEL_THRESHOLD,
              intensity: DEFAULT_SOBEL_INTENSITY,
            },
            blur: {
              enabled: DEFAULT_BLUR_ENABLED,
              radius: DEFAULT_BLUR_RADIUS,
            },
            regionPaint: {
              enabled: DEFAULT_REGION_PAINT_ENABLED,
              threshold: DEFAULT_REGION_PAINT_THRESHOLD,
              bandCount: DEFAULT_REGION_PAINT_BAND_COUNT,
              paletteId: DEFAULT_REGION_PAINT_PALETTE_ID,
            },
          };
        }
      });
    }
  }
}

/**
 * Get current settings
 */
export function getSettings(): Settings | undefined {
  return settingsCollection.state.get(SETTINGS_ID);
}

/**
 * Update username
 */
export function setUsername(username: string): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.username = username.trim();
    });
  }
}

/**
 * Update image size
 */
export function setImageSize(size: ImageSize): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.imageSize = size;
    });
  }
}

/**
 * Update scroll sensitivity
 */
export function setScrollSensitivity(sensitivity: number): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.scrollSensitivity = Math.max(0.1, Math.min(4.0, sensitivity));
    });
  }
}

/**
 * Update effects enabled state
 */
export function setEffectsEnabled(enabled: boolean): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.effectsEnabled = enabled;
    });
  }
}

/**
 * Update snap enabled state
 */
export function setSnapEnabled(enabled: boolean): void {
  const existing = getSettings();
  if (existing) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      draft.snapEnabled = enabled;
    });
  }
}

// Analysis Effects Setters

/**
 * Update overlay opacity for all analysis effects
 */
export function setOverlayOpacity(opacity: number): void {
  const existing = getSettings();
  if (existing?.analysisEffects) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      if (draft.analysisEffects) {
        draft.analysisEffects.overlayOpacity = Math.max(
          0,
          Math.min(1, opacity)
        );
      }
    });
  }
}

// Sobel Edge Setters

export function setSobelEnabled(enabled: boolean): void {
  const existing = getSettings();
  if (existing?.analysisEffects?.sobel) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      if (draft.analysisEffects?.sobel) {
        draft.analysisEffects.sobel.enabled = enabled;
      }
    });
  }
}

export function setSobelThreshold(threshold: number): void {
  const existing = getSettings();
  if (existing?.analysisEffects?.sobel) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      if (draft.analysisEffects?.sobel) {
        draft.analysisEffects.sobel.threshold = Math.max(
          0,
          Math.min(1, threshold)
        );
      }
    });
  }
}

export function setSobelIntensity(intensity: number): void {
  const existing = getSettings();
  if (existing?.analysisEffects?.sobel) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      if (draft.analysisEffects?.sobel) {
        draft.analysisEffects.sobel.intensity = Math.max(
          0,
          Math.min(3, intensity)
        );
      }
    });
  }
}

// Blur Setters

export function setBlurEnabled(enabled: boolean): void {
  const existing = getSettings();
  if (existing?.analysisEffects?.blur) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      if (draft.analysisEffects?.blur) {
        draft.analysisEffects.blur.enabled = enabled;
      }
    });
  }
}

export function setBlurRadius(radius: number): void {
  const existing = getSettings();
  if (existing?.analysisEffects?.blur) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      if (draft.analysisEffects?.blur) {
        draft.analysisEffects.blur.radius = Math.max(1, Math.min(20, radius));
      }
    });
  }
}

// Region Paint Setters

export function setRegionPaintEnabled(enabled: boolean): void {
  const existing = getSettings();
  if (existing?.analysisEffects?.regionPaint) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      if (draft.analysisEffects?.regionPaint) {
        draft.analysisEffects.regionPaint.enabled = enabled;
      }
    });
  }
}

export function setRegionPaintThreshold(threshold: number): void {
  const existing = getSettings();
  if (existing?.analysisEffects?.regionPaint) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      if (draft.analysisEffects?.regionPaint) {
        draft.analysisEffects.regionPaint.threshold = Math.max(
          0,
          Math.min(0.1, threshold)
        );
      }
    });
  }
}

export function setRegionPaintBandCount(bandCount: number): void {
  const existing = getSettings();
  if (existing?.analysisEffects?.regionPaint) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      if (draft.analysisEffects?.regionPaint) {
        draft.analysisEffects.regionPaint.bandCount = Math.max(
          2,
          Math.min(8, Math.round(bandCount))
        );
      }
    });
  }
}

export function setRegionPaintPaletteId(paletteId: string): void {
  const existing = getSettings();
  if (existing?.analysisEffects?.regionPaint) {
    settingsCollection.update(SETTINGS_ID, (draft) => {
      if (draft.analysisEffects?.regionPaint) {
        draft.analysisEffects.regionPaint.paletteId = paletteId;
      }
    });
  }
}
