import { Filter, GlProgram } from "pixi.js";
import {
  REGION_PAINT_FRAGMENT,
  REGION_PAINT_VERTEX,
} from "../shaders/region-paint.glsl";

export type RGB = [number, number, number];

export type RegionPaintParams = {
  bandCount: number;
  threshold: number;
  overlayOpacity: number;
  palette: RGB[];
};

/**
 * Default "heat map" palette from dark to light
 */
export const DEFAULT_PALETTE: RGB[] = [
  [0.1, 0.0, 0.2], // Deep purple (darkest)
  [0.3, 0.0, 0.5], // Purple
  [0.5, 0.0, 0.5], // Magenta
  [0.8, 0.2, 0.2], // Red
  [1.0, 0.5, 0.0], // Orange
  [1.0, 0.8, 0.0], // Yellow
  [0.8, 1.0, 0.4], // Light green
  [1.0, 1.0, 1.0], // White (brightest)
];

const DEFAULT_PARAMS: RegionPaintParams = {
  bandCount: 6,
  threshold: 0.02,
  overlayOpacity: 0.7,
  palette: DEFAULT_PALETTE,
};

/**
 * Factory for creating region paint (luminance banding) filter
 */
export const regionPaintFactory = {
  create(params: Partial<RegionPaintParams> = {}): Filter {
    const { bandCount, threshold, overlayOpacity, palette } = {
      ...DEFAULT_PARAMS,
      ...params,
    };

    // Flatten palette to Float32Array for uniform
    const flatPalette = new Float32Array(8 * 3);
    for (let i = 0; i < 8; i++) {
      const color = palette[i] ?? DEFAULT_PALETTE[i];
      flatPalette[i * 3] = color[0];
      flatPalette[i * 3 + 1] = color[1];
      flatPalette[i * 3 + 2] = color[2];
    }

    return new Filter({
      glProgram: new GlProgram({
        vertex: REGION_PAINT_VERTEX,
        fragment: REGION_PAINT_FRAGMENT,
      }),
      resources: {
        regionPaintUniforms: {
          uBandCount: { value: bandCount, type: "f32" },
          uThreshold: { value: threshold, type: "f32" },
          uOverlayOpacity: { value: overlayOpacity, type: "f32" },
          uPalette: { value: flatPalette, type: "vec3<f32>", size: 8 },
        },
      },
    });
  },

  updateUniforms(filter: Filter, params: Partial<RegionPaintParams>): void {
    const uniforms = filter.resources.regionPaintUniforms.uniforms;

    if (params.bandCount !== undefined) {
      uniforms.uBandCount = params.bandCount;
    }
    if (params.threshold !== undefined) {
      uniforms.uThreshold = params.threshold;
    }
    if (params.overlayOpacity !== undefined) {
      uniforms.uOverlayOpacity = params.overlayOpacity;
    }
    if (params.palette !== undefined) {
      const flatPalette = new Float32Array(8 * 3);
      for (let i = 0; i < 8; i++) {
        const color = params.palette[i] ?? DEFAULT_PALETTE[i];
        flatPalette[i * 3] = color[0];
        flatPalette[i * 3 + 1] = color[1];
        flatPalette[i * 3 + 2] = color[2];
      }
      uniforms.uPalette = flatPalette;
    }
  },
};
