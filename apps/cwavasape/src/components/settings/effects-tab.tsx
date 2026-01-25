import { Label } from "@avoid.quest/ui/components/label";
import { Switch } from "@avoid.quest/ui/components/switch";
import { setEffectsEnabled, setSnapEnabled } from "@/lib/collections/settings";
import { canRenderEffects, useCapabilities } from "@/lib/effects";
import { useSettings } from "@/lib/hooks/use-settings";

export function EffectsTab() {
  const { data: settings } = useSettings();
  const capabilities = useCapabilities();
  const canUseEffects = canRenderEffects(capabilities);

  const effectsEnabled = settings?.effectsEnabled ?? false;
  const snapEnabled = settings?.snapEnabled ?? false;

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
      <div className="flex items-center justify-between">
        <Label htmlFor="effects-enabled">GPU Effects</Label>
        <Switch
          checked={effectsEnabled}
          id="effects-enabled"
          onCheckedChange={setEffectsEnabled}
        />
      </div>

      {effectsEnabled && (
        <div className="flex items-center justify-between">
          <Label htmlFor="snap-enabled">Instant Snap</Label>
          <Switch
            checked={snapEnabled}
            id="snap-enabled"
            onCheckedChange={setSnapEnabled}
          />
        </div>
      )}
    </div>
  );
}
