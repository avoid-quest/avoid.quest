/**
 * Effect Visualization Selector
 *
 * Renders the appropriate visualization for an effect based on its schema.
 */

import type { CompressorConfig, EffectConfig, RevampConfig } from "@/lib/audio";
import { getEffectSchema } from "@/lib/audio/dsp/effects/schema";
import { CompressorCanvas } from "./compressor-canvas";
import { EQCanvas } from "./eq-canvas";

type EffectVisualizationProps = {
  effect: EffectConfig;
  className?: string;
};

export function EffectVisualization({
  effect,
  className,
}: EffectVisualizationProps) {
  const schema = getEffectSchema(effect.type);
  const visualization = schema?.visualization;

  if (!visualization || visualization === "none") {
    return null;
  }

  switch (visualization) {
    case "eq-curve":
      return <EQCanvas className={className} config={effect as RevampConfig} />;
    case "compressor-curve":
      return (
        <CompressorCanvas
          className={className}
          config={effect as CompressorConfig}
        />
      );
    default:
      return null;
  }
}
