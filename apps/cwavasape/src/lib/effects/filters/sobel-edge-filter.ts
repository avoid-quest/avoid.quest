import { Filter, GlProgram } from "pixi.js";
import { SOBEL_FRAGMENT, SOBEL_VERTEX } from "../shaders/sobel-edge.glsl";

export type SobelEdgeParams = {
  threshold: number;
  intensity: number;
  overlayOpacity: number;
};

const DEFAULT_PARAMS: SobelEdgeParams = {
  threshold: 0.1,
  intensity: 1.0,
  overlayOpacity: 0.5,
};

/**
 * Factory for creating Sobel edge detection filter
 */
export const sobelEdgeFactory = {
  create(params: Partial<SobelEdgeParams> = {}): Filter {
    const { threshold, intensity, overlayOpacity } = {
      ...DEFAULT_PARAMS,
      ...params,
    };

    return new Filter({
      glProgram: new GlProgram({
        vertex: SOBEL_VERTEX,
        fragment: SOBEL_FRAGMENT,
      }),
      resources: {
        sobelUniforms: {
          uThreshold: { value: threshold, type: "f32" },
          uIntensity: { value: intensity, type: "f32" },
          uOverlayOpacity: { value: overlayOpacity, type: "f32" },
        },
      },
    });
  },

  updateUniforms(filter: Filter, params: Partial<SobelEdgeParams>): void {
    const uniforms = filter.resources.sobelUniforms.uniforms;
    if (params.threshold !== undefined) {
      uniforms.uThreshold = params.threshold;
    }
    if (params.intensity !== undefined) {
      uniforms.uIntensity = params.intensity;
    }
    if (params.overlayOpacity !== undefined) {
      uniforms.uOverlayOpacity = params.overlayOpacity;
    }
  },
};
