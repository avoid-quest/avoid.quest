import { isEnabled } from "@avoid.quest/shared";
import { Label } from "@avoid.quest/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { Switch } from "@avoid.quest/ui/components/switch";
import {
  setBlurEnabled,
  setBlurRadius,
  setEffectsEnabled,
  setOverlayOpacity,
  setRegionPaintBandCount,
  setRegionPaintEnabled,
  setRegionPaintPaletteId,
  setRegionPaintThreshold,
  setSnapEnabled,
  setSobelEnabled,
  setSobelIntensity,
  setSobelThreshold,
} from "@/lib/collections/settings";
import {
  DEFAULT_BLUR_RADIUS,
  DEFAULT_OVERLAY_OPACITY,
  DEFAULT_REGION_PAINT_BAND_COUNT,
  DEFAULT_REGION_PAINT_THRESHOLD,
  DEFAULT_SOBEL_INTENSITY,
  DEFAULT_SOBEL_THRESHOLD,
  REGION_PAINT_PALETTES,
} from "@/lib/const";
import { canRenderEffects, useCapabilities } from "@/lib/effects";
import { useSettings } from "@/lib/hooks/use-settings";
import { EffectParameterSlider } from "./effect-parameter-slider";
import { EffectSection } from "./effect-section";

export function EffectsTab() {
  const { data: settings } = useSettings();
  const capabilities = useCapabilities();
  const canUseEffects = canRenderEffects(capabilities);

  const effectsEnabled = settings?.effectsEnabled ?? false;
  const snapEnabled = settings?.snapEnabled ?? false;
  const analysisEffects = settings?.analysisEffects;

  // Hide entire effects section if master flag is off
  if (!isEnabled("cwavasape.effects")) {
    return null;
  }

  if (!canUseEffects) {
    return (
      <div className="space-y-2">
        <Label className="text-muted-foreground text-sm">Effects</Label>
        <p className="text-muted-foreground text-xs">
          GPU effects require WebGL2 or WebGPU support.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Master GPU toggle */}
      <div className="flex items-center justify-between">
        <Label htmlFor="effects-enabled">GPU Effects</Label>
        <Switch
          checked={effectsEnabled}
          id="effects-enabled"
          onCheckedChange={setEffectsEnabled}
        />
      </div>

      {effectsEnabled && (
        <>
          {/* Snap toggle - controlled by feature flag */}
          {isEnabled("cwavasape.effects.snap") && (
            <div className="flex items-center justify-between">
              <Label htmlFor="snap-enabled">Instant Snap</Label>
              <Switch
                checked={snapEnabled}
                id="snap-enabled"
                onCheckedChange={setSnapEnabled}
              />
            </div>
          )}

          {/* Overlay opacity - controlled by feature flag */}
          {isEnabled("cwavasape.effects.overlay") && (
            <EffectParameterSlider
              defaultValue={DEFAULT_OVERLAY_OPACITY}
              label="Effect Overlay Opacity"
              max={1}
              min={0}
              onChange={setOverlayOpacity}
              step={0.05}
              value={analysisEffects?.overlayOpacity ?? DEFAULT_OVERLAY_OPACITY}
            />
          )}

          {/* Sobel Edge Detection - controlled by feature flag */}
          {isEnabled("cwavasape.effects.sobel") && (
            <EffectSection
              enabled={analysisEffects?.sobel?.enabled ?? false}
              onEnabledChange={setSobelEnabled}
              title="Edge Detection"
            >
              <EffectParameterSlider
                defaultValue={DEFAULT_SOBEL_THRESHOLD}
                label="Threshold"
                max={1}
                min={0}
                onChange={setSobelThreshold}
                step={0.01}
                value={
                  analysisEffects?.sobel?.threshold ?? DEFAULT_SOBEL_THRESHOLD
                }
              />
              <EffectParameterSlider
                defaultValue={DEFAULT_SOBEL_INTENSITY}
                label="Intensity"
                max={3}
                min={0}
                onChange={setSobelIntensity}
                step={0.1}
                value={
                  analysisEffects?.sobel?.intensity ?? DEFAULT_SOBEL_INTENSITY
                }
              />
            </EffectSection>
          )}

          {/* Gaussian Blur - controlled by feature flag */}
          {isEnabled("cwavasape.effects.blur") && (
            <EffectSection
              enabled={analysisEffects?.blur?.enabled ?? false}
              onEnabledChange={setBlurEnabled}
              title="Blur"
            >
              <EffectParameterSlider
                defaultValue={DEFAULT_BLUR_RADIUS}
                formatValue={(v) => `${Math.round(v)}px`}
                label="Radius"
                max={20}
                min={1}
                onChange={setBlurRadius}
                step={1}
                value={analysisEffects?.blur?.radius ?? DEFAULT_BLUR_RADIUS}
              />
            </EffectSection>
          )}

          {/* Region Paint - controlled by feature flag */}
          {isEnabled("cwavasape.effects.regionPaint") && (
            <EffectSection
              enabled={analysisEffects?.regionPaint?.enabled ?? false}
              onEnabledChange={setRegionPaintEnabled}
              title="Region Paint"
            >
              <EffectParameterSlider
                defaultValue={DEFAULT_REGION_PAINT_BAND_COUNT}
                formatValue={(v) => `${Math.round(v)} bands`}
                label="Band Count"
                max={8}
                min={2}
                onChange={setRegionPaintBandCount}
                step={1}
                value={
                  analysisEffects?.regionPaint?.bandCount ??
                  DEFAULT_REGION_PAINT_BAND_COUNT
                }
              />
              <EffectParameterSlider
                defaultValue={DEFAULT_REGION_PAINT_THRESHOLD}
                label="Edge Smoothing"
                max={0.1}
                min={0}
                onChange={setRegionPaintThreshold}
                step={0.005}
                value={
                  analysisEffects?.regionPaint?.threshold ??
                  DEFAULT_REGION_PAINT_THRESHOLD
                }
              />
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">
                  Color Palette
                </Label>
                <Select
                  onValueChange={setRegionPaintPaletteId}
                  value={analysisEffects?.regionPaint?.paletteId ?? "heat"}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select palette" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(REGION_PAINT_PALETTES).map(
                      ([id, palette]) => (
                        <SelectItem key={id} value={id}>
                          {palette.name}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
            </EffectSection>
          )}
        </>
      )}
    </div>
  );
}
