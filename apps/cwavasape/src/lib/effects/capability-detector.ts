import { useEffect, useState } from "react";

export type CapabilityTier = "webgpu" | "webgl2" | "fallback";

export type Capabilities = {
  tier: CapabilityTier;
  webgpu: boolean;
  webgl2: boolean;
  maxTextureSize: number;
  supportsFloat: boolean;
  isDetected: boolean;
};

function detectCapabilities(): Capabilities {
  // Check WebGPU
  const webgpu = "gpu" in navigator;

  // Check WebGL2
  let webgl2 = false;
  let maxTextureSize = 2048;
  let supportsFloat = false;

  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (gl) {
      webgl2 = true;
      maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      supportsFloat =
        gl.getExtension("EXT_color_buffer_float") !== null ||
        gl.getExtension("OES_texture_float") !== null;
    }
  } catch (err) {
    // WebGL2 not available - graceful fallback
    if (import.meta.env.DEV) {
      console.warn("WebGL2 capability detection failed:", err);
    }
  }

  // Determine tier
  let tier: CapabilityTier = "fallback";
  if (webgpu) {
    tier = "webgpu";
  } else if (webgl2) {
    tier = "webgl2";
  }

  return {
    tier,
    webgpu,
    webgl2,
    maxTextureSize,
    supportsFloat,
    isDetected: true,
  };
}

const defaultCapabilities: Capabilities = {
  tier: "fallback",
  webgpu: false,
  webgl2: false,
  maxTextureSize: 2048,
  supportsFloat: false,
  isDetected: false,
};

export function useCapabilities(): Capabilities {
  const [capabilities, setCapabilities] =
    useState<Capabilities>(defaultCapabilities);

  useEffect(() => {
    // Detect capabilities on client after hydration
    setCapabilities(detectCapabilities());
  }, []);

  return capabilities;
}

/**
 * Check if effects can be rendered (capabilities detected and WebGL2 or WebGPU available)
 */
export function canRenderEffects(capabilities: Capabilities): boolean {
  return capabilities.isDetected && capabilities.tier !== "fallback";
}
