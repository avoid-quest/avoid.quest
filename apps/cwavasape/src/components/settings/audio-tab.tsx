import { isEnabled } from "@avoid.quest/shared";
import { Label } from "@avoid.quest/ui/components/label";
import { Switch } from "@avoid.quest/ui/components/switch";
import {
  getAudioEngine,
  loadSampleManifest,
  preloadSamples,
} from "@/lib/audio";
import { setAudioEnabled, setAudioVolume } from "@/lib/collections/settings";
import { DEFAULT_AUDIO_VOLUME } from "@/lib/const";
import { useSettings } from "@/lib/hooks/use-settings";
import { EffectParameterSlider } from "./effect-parameter-slider";

function handleAudioToggle(enabled: boolean, volume: number): void {
  setAudioEnabled(enabled);

  if (!enabled) {
    return;
  }

  // Initialize AudioContext synchronously within this click gesture
  const engine = getAudioEngine();
  engine.initialize();
  engine.setVolume(volume);

  // Load samples async
  loadSampleManifest().then((keys) => {
    if (keys.length > 0) {
      preloadSamples(keys);
    }
  });
}

export function AudioTab() {
  const { data: settings } = useSettings();

  if (!isEnabled("cwavasape.audio")) {
    return null;
  }

  const audioEnabled = settings?.audioEnabled ?? false;
  const audioVolume = settings?.audioVolume ?? DEFAULT_AUDIO_VOLUME;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label htmlFor="audio-enabled">Audio</Label>
        <Switch
          checked={audioEnabled}
          id="audio-enabled"
          onCheckedChange={(enabled) => handleAudioToggle(enabled, audioVolume)}
        />
      </div>

      {audioEnabled && (
        <EffectParameterSlider
          defaultValue={DEFAULT_AUDIO_VOLUME}
          formatValue={(v) => `${Math.round(v * 100)}%`}
          label="Volume"
          max={1}
          min={0}
          onChange={setAudioVolume}
          step={0.05}
          value={audioVolume}
        />
      )}
    </div>
  );
}
