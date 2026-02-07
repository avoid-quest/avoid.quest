import type { ImageSize } from "@avoid.quest/pinterest";
import type { RGB } from "./effects/filters";

export const DEFAULT_USERNAME = "gemakara";
export const DEFAULT_IMAGE_SIZE: ImageSize = "474x";
export const DEFAULT_SCROLL_SENSITIVITY = 1.0;
export const DEFAULT_EFFECTS_ENABLED = false;
export const DEFAULT_SNAP_ENABLED = false;
export const DEFAULT_AUDIO_ENABLED = false;
export const DEFAULT_AUDIO_VOLUME = 0.5;

// Scroll throttle constants
export const SCROLL_THROTTLE_MS = 16; // ~60fps
export const FETCH_THROTTLE_MS = 500; // Prevent rapid pagination calls
export const WHEEL_THROTTLE_MS = 8; // ~120fps for smooth custom scroll
export const DIRECTION_VELOCITY_THRESHOLD = 0.5; // px/ms - threshold for direction detection

// Analysis Effects Defaults
export const DEFAULT_OVERLAY_OPACITY = 0.5;

// Sobel edge detection defaults
export const DEFAULT_SOBEL_ENABLED = false;
export const DEFAULT_SOBEL_THRESHOLD = 0.1;
export const DEFAULT_SOBEL_INTENSITY = 1.0;

// Gaussian blur defaults
export const DEFAULT_BLUR_ENABLED = false;
export const DEFAULT_BLUR_RADIUS = 5;

// Region paint defaults
export const DEFAULT_REGION_PAINT_ENABLED = false;
export const DEFAULT_REGION_PAINT_THRESHOLD = 0.02;
export const DEFAULT_REGION_PAINT_BAND_COUNT = 6;
export const DEFAULT_REGION_PAINT_PALETTE_ID = "heat" as const;

// Palette presets for region paint effect
export const REGION_PAINT_PALETTES: Record<
  string,
  { name: string; colors: RGB[] }
> = {
  heat: {
    name: "Heat Map",
    colors: [
      [0.1, 0.0, 0.2],
      [0.3, 0.0, 0.5],
      [0.5, 0.0, 0.5],
      [0.8, 0.2, 0.2],
      [1.0, 0.5, 0.0],
      [1.0, 0.8, 0.0],
      [0.8, 1.0, 0.4],
      [1.0, 1.0, 1.0],
    ],
  },
  ocean: {
    name: "Ocean",
    colors: [
      [0.0, 0.05, 0.1],
      [0.0, 0.1, 0.2],
      [0.0, 0.2, 0.4],
      [0.0, 0.4, 0.6],
      [0.2, 0.6, 0.8],
      [0.4, 0.8, 0.9],
      [0.7, 0.95, 1.0],
      [1.0, 1.0, 1.0],
    ],
  },
  forest: {
    name: "Forest",
    colors: [
      [0.05, 0.1, 0.0],
      [0.1, 0.2, 0.05],
      [0.15, 0.3, 0.1],
      [0.2, 0.4, 0.15],
      [0.3, 0.5, 0.2],
      [0.5, 0.7, 0.3],
      [0.7, 0.85, 0.5],
      [0.9, 1.0, 0.8],
    ],
  },
  grayscale: {
    name: "Grayscale",
    colors: [
      [0.0, 0.0, 0.0],
      [0.15, 0.15, 0.15],
      [0.3, 0.3, 0.3],
      [0.45, 0.45, 0.45],
      [0.6, 0.6, 0.6],
      [0.75, 0.75, 0.75],
      [0.9, 0.9, 0.9],
      [1.0, 1.0, 1.0],
    ],
  },
};
