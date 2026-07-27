import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import { Label } from "@avoid.quest/ui/components/label";
import { useState } from "react";
import type { EffectConfig } from "@/lib/audio";
import {
  createLocalNamModelId,
  saveNamModel,
} from "@/lib/audio/dsp/effects/nam-model-store";

type Tone3000ModelParamsProps = {
  effect: Extract<EffectConfig, { type: "neuralAmp" }>;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

export function parseNamModel(
  modelName: string,
  modelData: string
): { modelData: string; modelName: string } {
  const parsed = JSON.parse(modelData) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("NAM model must contain a JSON object.");
  }
  return { modelName, modelData };
}

export function Tone3000ModelParams({
  effect,
  onUpdate,
}: Tone3000ModelParamsProps) {
  const [status, setStatus] = useState<string | null>(null);

  const loadFile = async (file: File) => {
    try {
      const model = parseNamModel(file.name, await file.text());
      const modelId = createLocalNamModelId();
      await saveNamModel(modelId, model.modelData);
      onUpdate({
        modelName: model.modelName,
        modelData: null,
        modelId,
        modelUrl: null,
      } as Partial<EffectConfig>);
      setStatus(`Loaded ${file.name} locally.`);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Invalid NAM model.");
    }
  };

  return (
    <div className="space-y-2 rounded-md border p-3">
      <Label htmlFor={`${effect.id}-nam-model`}>Local NAM model</Label>
      <Input
        accept=".nam,application/json"
        id={`${effect.id}-nam-model`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            loadFile(file);
          }
        }}
        type="file"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-muted-foreground text-xs">
          {effect.modelName ?? "No local model selected"}
        </p>
        {effect.modelId && (
          <Button
            onClick={() => {
              onUpdate({
                modelId: null,
                modelName: null,
                modelData: null,
              } as Partial<EffectConfig>);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            Clear
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        Stored in this browser&apos;s model database; sessions keep only its
        identifier and name. No model, credentials, or network request is
        bundled.
      </p>
      {status && <p className="text-xs">{status}</p>}
    </div>
  );
}
