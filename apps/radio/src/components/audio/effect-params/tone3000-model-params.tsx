import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import { Label } from "@avoid.quest/ui/components/label";
import { useEffect, useState } from "react";
import type { EffectConfig } from "@/lib/audio";
import {
  deleteNamModel,
  ingestLocalNamModel,
  type LocalNamModelMetadata,
} from "@/lib/audio/dsp/effects/nam-model-store";

export { parseNamModel } from "@/lib/audio/dsp/effects/nam-model-store";

type Tone3000ModelParamsProps = {
  effect: Extract<EffectConfig, { type: "neuralAmp" }>;
  onUpdate: (config: Partial<EffectConfig>) => void;
};

type NamModelFile = Pick<File, "name" | "text">;
type NamModelLoaderDependencies = {
  discard: (modelId: string) => Promise<void>;
  ingest: (
    modelName: string,
    modelData: string
  ) => Promise<LocalNamModelMetadata>;
};

export function createNamModelLoader({
  discard = deleteNamModel,
  ingest = ingestLocalNamModel,
}: Partial<NamModelLoaderDependencies> = {}) {
  let generation = 0;
  let identity: string | undefined;
  return {
    invalidate: () => {
      generation++;
    },
    synchronize: (nextIdentity: string) => {
      if (nextIdentity !== identity) {
        identity = nextIdentity;
        generation++;
      }
    },
    load: async (file: NamModelFile): Promise<LocalNamModelMetadata | null> => {
      const request = ++generation;
      try {
        const modelData = await file.text();
        if (request !== generation) {
          return null;
        }
        const model = await ingest(file.name, modelData);
        if (request !== generation) {
          await discard(model.modelId);
          return null;
        }
        return model;
      } catch (cause) {
        if (request !== generation) {
          return null;
        }
        throw cause;
      }
    },
  };
}

export function Tone3000ModelParams({
  effect,
  onUpdate,
}: Tone3000ModelParamsProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [loader] = useState(createNamModelLoader);
  loader.synchronize(
    JSON.stringify([effect.modelId, effect.modelUrl, effect.modelData])
  );

  useEffect(() => () => loader.invalidate(), [loader]);

  const loadFile = async (file: File) => {
    try {
      const model = await loader.load(file);
      if (!model) {
        return;
      }
      onUpdate(model);
      setStatus(`Loaded ${model.modelName} locally.`);
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
              loader.invalidate();
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
