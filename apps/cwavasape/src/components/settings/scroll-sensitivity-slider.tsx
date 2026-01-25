import { Label } from "@avoid.quest/ui/components/label";
import { Slider } from "@avoid.quest/ui/components/slider";
import { DEFAULT_SCROLL_SENSITIVITY } from "@/lib/const";
import { setScrollSensitivity, useSettings } from "@/lib/hooks/use-settings";

export function ScrollSensitivitySlider() {
  const { data: settings } = useSettings();
  const scrollSensitivity =
    settings?.scrollSensitivity ?? DEFAULT_SCROLL_SENSITIVITY;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label htmlFor="scroll-sensitivity">Scroll Sensitivity</Label>
        <span className="text-muted-foreground text-sm">
          {scrollSensitivity}x
        </span>
      </div>
      <Slider
        defaultValue={[1.0]}
        id="scroll-sensitivity"
        max={4.0}
        min={0.1}
        onValueChange={([value]) => {
          if (value !== undefined) {
            setScrollSensitivity(Math.round(value * 10) / 10);
          }
        }}
        step={0.1}
        value={[scrollSensitivity]}
      />
      <p className="text-muted-foreground text-xs">
        Adjust how fast the gallery scrolls. Double-click to reset.
      </p>
    </div>
  );
}
