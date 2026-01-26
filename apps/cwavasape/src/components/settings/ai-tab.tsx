/**
 * AI Analysis Settings Tab
 *
 * Settings UI for AI features: detection, segmentation, and OCR.
 */

import { Label } from "@avoid.quest/ui/components/label";
import { Progress } from "@avoid.quest/ui/components/progress";
import { Switch } from "@avoid.quest/ui/components/switch";
import { useAI } from "@/lib/ai/use-ai";
import {
  setAIAutoAnalyze,
  setAIDetectionEnabled,
  setAIDetectionShowOverlay,
  setAIDetectionThreshold,
  setAIEnabled,
  setAIOCREnabled,
  setAIOCRShowOverlay,
  setAISegmentationEnabled,
  setAISegmentationShowOverlay,
} from "@/lib/collections/settings";
import { DEFAULT_AI_DETECTION_THRESHOLD } from "@/lib/const";
import { useSettings } from "@/lib/hooks/use-settings";
import { EffectParameterSlider } from "./effect-parameter-slider";
import { EffectSection } from "./effect-section";

/**
 * Model loading progress indicator
 */
function ModelProgress({
  label,
  status,
  progress,
}: {
  label: string;
  status: "idle" | "loading" | "ready" | "error";
  progress: number;
}) {
  if (status === "idle") {
    return null;
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">
          {status === "loading" && `${Math.round(progress)}%`}
          {status === "ready" && "Ready"}
          {status === "error" && "Error"}
        </span>
      </div>
      {status === "loading" && <Progress className="h-1" value={progress} />}
    </div>
  );
}

export function AITab() {
  const { data: settings } = useSettings();
  const { modelStates } = useAI();
  const aiSettings = settings?.aiSettings;

  return (
    <div className="space-y-4">
      {/* Master AI toggle */}
      <div className="flex items-center justify-between">
        <Label htmlFor="ai-enabled">AI Analysis</Label>
        <Switch
          checked={aiSettings?.enabled ?? false}
          id="ai-enabled"
          onCheckedChange={setAIEnabled}
        />
      </div>

      {aiSettings?.enabled && (
        <>
          {/* Info about model downloads */}
          <p className="text-muted-foreground text-xs">
            Models download on first use (~40-100MB each). Analysis runs locally
            in your browser.
          </p>

          {/* Model loading progress */}
          <div className="space-y-2">
            <ModelProgress
              label="Object Detection"
              progress={modelStates.detector.progress}
              status={modelStates.detector.status}
            />
            <ModelProgress
              label="Segmentation"
              progress={modelStates.segmenter.progress}
              status={modelStates.segmenter.status}
            />
            <ModelProgress
              label="OCR"
              progress={modelStates.ocr.progress}
              status={modelStates.ocr.status}
            />
          </div>

          {/* Auto-analyze toggle */}
          <div className="flex items-center justify-between">
            <Label className="text-sm" htmlFor="ai-auto-analyze">
              Auto-analyze on load
            </Label>
            <Switch
              checked={aiSettings?.autoAnalyze ?? true}
              id="ai-auto-analyze"
              onCheckedChange={setAIAutoAnalyze}
            />
          </div>

          {/* Object Detection */}
          <EffectSection
            enabled={aiSettings?.detection.enabled ?? false}
            onEnabledChange={setAIDetectionEnabled}
            title="Object Detection"
          >
            <EffectParameterSlider
              defaultValue={DEFAULT_AI_DETECTION_THRESHOLD}
              label="Confidence Threshold"
              max={0.9}
              min={0.1}
              onChange={setAIDetectionThreshold}
              step={0.05}
              value={
                aiSettings?.detection.threshold ??
                DEFAULT_AI_DETECTION_THRESHOLD
              }
            />
            <div className="flex items-center justify-between pt-2">
              <Label className="text-muted-foreground text-xs">
                Show bounding boxes
              </Label>
              <Switch
                checked={aiSettings?.detection.showOverlay ?? true}
                onCheckedChange={setAIDetectionShowOverlay}
              />
            </div>
          </EffectSection>

          {/* Segmentation */}
          <EffectSection
            enabled={aiSettings?.segmentation.enabled ?? false}
            onEnabledChange={setAISegmentationEnabled}
            title="Segmentation"
          >
            <p className="text-muted-foreground text-xs">
              Identifies different regions and objects in the image.
            </p>
            <div className="flex items-center justify-between pt-2">
              <Label className="text-muted-foreground text-xs">
                Show mask overlay
              </Label>
              <Switch
                checked={aiSettings?.segmentation.showOverlay ?? true}
                onCheckedChange={setAISegmentationShowOverlay}
              />
            </div>
          </EffectSection>

          {/* OCR */}
          <EffectSection
            enabled={aiSettings?.ocr.enabled ?? false}
            onEnabledChange={setAIOCREnabled}
            title="Text Recognition (OCR)"
          >
            <p className="text-muted-foreground text-xs">
              Extracts visible text from images.
            </p>
            <div className="flex items-center justify-between pt-2">
              <Label className="text-muted-foreground text-xs">
                Show extracted text
              </Label>
              <Switch
                checked={aiSettings?.ocr.showOverlay ?? true}
                onCheckedChange={setAIOCRShowOverlay}
              />
            </div>
          </EffectSection>
        </>
      )}
    </div>
  );
}
