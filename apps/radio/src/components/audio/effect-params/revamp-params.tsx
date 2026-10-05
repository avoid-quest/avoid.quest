/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Switch } from "@avoid.quest/ui/components/switch";
import { cn } from "@avoid.quest/ui/lib/utils";
import { MidiControlWrapper } from "@/components/audio/midi-control-wrapper";
import type { EffectConfig, RevampConfig } from "@/lib/audio";
import { getEffectDefaultConfig } from "@/lib/audio/dsp/effects/schema";
import { ParamSelect } from "./param-select";
import { ParamSlider } from "./param-slider";
import { UniversalParams } from "./universal-params";

type RevampParamsProps = {
  effect: RevampConfig;
  onUpdate: (config: Partial<EffectConfig>) => void;
  deckId?: "deck-a" | "deck-b";
  effectId?: string;
  midiTargetPrefix?: string;
};

type Band = {
  prefix: string;
  name: string;
  hasGain: boolean;
  hasQ: boolean;
  hasOrder: boolean;
};

/** Left to right in frequency order, like the curve above them. */
const BANDS: Band[] = [
  {
    hasGain: false,
    hasOrder: true,
    hasQ: true,
    name: "HP",
    prefix: "highPass",
  },
  {
    hasGain: true,
    hasOrder: false,
    hasQ: false,
    name: "LS",
    prefix: "lowShelf",
  },
  { hasGain: true, hasOrder: false, hasQ: true, name: "Lo", prefix: "lowBell" },
  {
    hasGain: true,
    hasOrder: false,
    hasQ: true,
    name: "Mid",
    prefix: "midBell",
  },
  {
    hasGain: true,
    hasOrder: false,
    hasQ: true,
    name: "Hi",
    prefix: "highBell",
  },
  {
    hasGain: true,
    hasOrder: false,
    hasQ: false,
    name: "HS",
    prefix: "highShelf",
  },
  { hasGain: false, hasOrder: true, hasQ: true, name: "LP", prefix: "lowPass" },
];

const BAND_TITLES: Record<string, string> = {
  Hi: "High bell",
  HP: "High pass",
  HS: "High shelf",
  Lo: "Low bell",
  LP: "Low pass",
  LS: "Low shelf",
  Mid: "Mid bell",
};

const SLOPE_OPTIONS = [
  { label: "6 dB", value: "1" },
  { label: "12 dB", value: "2" },
  { label: "18 dB", value: "3" },
  { label: "24 dB", value: "4" },
];

function num(config: RevampConfig, key: string): number {
  const value = (config as unknown as Record<string, unknown>)[key];
  return typeof value === "number" ? value : 0;
}

/** The 7-band EQ as seven columns under its curve: switch, then the band's knobs. */
export function RevampParams({
  effect,
  onUpdate,
  deckId,
  effectId,
  midiTargetPrefix,
}: RevampParamsProps) {
  const defaults = getEffectDefaultConfig("revamp") as unknown as Record<
    string,
    number
  >;
  const targetPrefix =
    midiTargetPrefix ??
    (deckId && effectId ? `${deckId}:effect:${effectId}` : undefined);
  const knob = (
    key: string,
    label: string,
    props: {
      min: number;
      max: number;
      step: number;
      formatKey: string;
      bipolar?: boolean;
    }
  ) => {
    const control = (
      <ParamSlider
        bipolar={props.bipolar}
        defaultValue={defaults[key]}
        formatKey={props.formatKey}
        label={label}
        max={props.max}
        min={props.min}
        onChange={(next) => onUpdate({ [key]: next } as Partial<EffectConfig>)}
        step={props.step}
        value={num(effect, key)}
      />
    );
    return targetPrefix ? (
      <MidiControlWrapper key={key} targetId={`${targetPrefix}:${key}`}>
        {control}
      </MidiControlWrapper>
    ) : (
      <div key={key}>{control}</div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {BANDS.map((band) => {
          const enabledKey = `${band.prefix}Enabled`;
          const enabled =
            (effect as unknown as Record<string, unknown>)[enabledKey] === true;
          return (
            <div
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md border border-border/50 px-1 py-1.5",
                !enabled && "opacity-50"
              )}
              key={band.prefix}
            >
              <span
                className="whitespace-nowrap font-mono text-[9px] text-muted-foreground uppercase tracking-wider"
                title={BAND_TITLES[band.name]}
              >
                {band.name}
              </span>
              <Switch
                aria-label={`${band.name} enabled`}
                checked={enabled}
                onCheckedChange={(checked) =>
                  onUpdate({ [enabledKey]: checked } as Partial<EffectConfig>)
                }
              />
              {knob(`${band.prefix}Frequency`, "Freq", {
                formatKey: "frequency",
                max: 20_000,
                min: 20,
                step: 1,
              })}
              {band.hasGain
                ? knob(`${band.prefix}Gain`, "Gain", {
                    bipolar: true,
                    formatKey: "db",
                    max: 40,
                    min: -40,
                    step: 0.1,
                  })
                : null}
              {band.hasQ
                ? knob(`${band.prefix}Q`, "Q", {
                    formatKey: "q",
                    max: 30,
                    min: 0.1,
                    step: 0.1,
                  })
                : null}
              {band.hasOrder ? (
                <ParamSelect
                  // A band column is 31-43px wide: fill it, drop the chevron and
                  // size the value like the knob values so "24 dB" still fits.
                  className="w-full [&_button]:w-full [&_button]:justify-center [&_button]:px-0! [&_button]:text-[10px]! [&_button_svg]:hidden"
                  label="Slope"
                  onChange={(next) =>
                    onUpdate({
                      [`${band.prefix}Order`]: Number(next),
                    } as Partial<EffectConfig>)
                  }
                  options={SLOPE_OPTIONS}
                  value={String(num(effect, `${band.prefix}Order`) || 2)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <UniversalParams
        deckId={deckId}
        effect={effect}
        effectId={effectId}
        midiTargetPrefix={midiTargetPrefix}
        onUpdate={onUpdate}
      />
    </div>
  );
}
