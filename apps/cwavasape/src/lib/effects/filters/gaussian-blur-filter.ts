import { Filter, GlProgram } from "pixi.js";
import {
  BLUR_HORIZONTAL_FRAGMENT,
  BLUR_VERTEX,
  BLUR_VERTICAL_FRAGMENT,
} from "../shaders/blur.glsl";

export type GaussianBlurParams = {
  radius: number;
};

const DEFAULT_PARAMS: GaussianBlurParams = {
  radius: 5,
};

export type GaussianBlurFilters = {
  horizontal: Filter;
  vertical: Filter;
};

/**
 * Factory for creating separable Gaussian blur filters
 * Returns two filters (horizontal + vertical) for efficient two-pass blur
 */
export const gaussianBlurFactory = {
  create(params: Partial<GaussianBlurParams> = {}): GaussianBlurFilters {
    const { radius } = { ...DEFAULT_PARAMS, ...params };

    const horizontal = new Filter({
      glProgram: new GlProgram({
        vertex: BLUR_VERTEX,
        fragment: BLUR_HORIZONTAL_FRAGMENT,
      }),
      resources: {
        blurUniforms: {
          uRadius: { value: radius, type: "f32" },
        },
      },
    });

    const vertical = new Filter({
      glProgram: new GlProgram({
        vertex: BLUR_VERTEX,
        fragment: BLUR_VERTICAL_FRAGMENT,
      }),
      resources: {
        blurUniforms: {
          uRadius: { value: radius, type: "f32" },
        },
      },
    });

    return { horizontal, vertical };
  },

  updateUniforms(
    filters: GaussianBlurFilters,
    params: Partial<GaussianBlurParams>
  ): void {
    if (params.radius !== undefined) {
      filters.horizontal.resources.blurUniforms.uniforms.uRadius =
        params.radius;
      filters.vertical.resources.blurUniforms.uniforms.uRadius = params.radius;
    }
  },

  toArray(filters: GaussianBlurFilters): Filter[] {
    return [filters.horizontal, filters.vertical];
  },
};
