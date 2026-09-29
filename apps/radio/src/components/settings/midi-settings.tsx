// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
/**
 * MIDI Settings UI
 *
 * Connected device list, preset selector, mapping table with learn mode.
 */

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@avoid.quest/ui/components/alert";
import { Button } from "@avoid.quest/ui/components/button";
import {
  Field,
  FieldLabel,
  FieldTitle,
} from "@avoid.quest/ui/components/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { Switch } from "@avoid.quest/ui/components/switch";
import { cn } from "@avoid.quest/ui/lib/utils";
import {
  CircleIcon,
  InfoIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useMidiControlSnapshot } from "@/lib/hooks/use-midi";
import { usePlayerMode } from "@/lib/hooks/use-settings";
import {
  getMidiControl,
  MIDI_PRESETS,
  type MidiActionDescriptor,
  type MidiMapping,
} from "@/lib/midi";

/** Same row layout as the Playback tab's AudioSettingRow. */
const SETTING_ROW_CLASS =
  "py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(18rem,28rem)] sm:items-center";

function formatMapping(mapping: MidiMapping | undefined): string {
  if (!mapping) {
    return "Not mapped";
  }
  const typeLabel = mapping.type === "cc" ? "CC" : "Note";
  const transformInfo = mapping.transform
    ? ` ${mapping.transform.invert ? "INV " : ""}${mapping.transform.curve === "linear" ? "" : mapping.transform.curve}`
    : "";
  return `${typeLabel} ${mapping.control} ch.${mapping.channel + 1}${transformInfo}`;
}

type MappingRowProps = {
  targetId: string;
  label: string;
  mapping: MidiMapping | undefined;
  isLearning: boolean;
  isLearningTarget: boolean;
  onStartLearn: (targetId: string) => void;
  onStopLearn: () => void;
  onRemove: (targetId: string) => void;
};

function MappingRow({
  targetId,
  label,
  mapping,
  isLearning,
  isLearningTarget,
  onStartLearn,
  onStopLearn,
  onRemove,
}: MappingRowProps) {
  const handleStartLearn = () => {
    onStartLearn(targetId);
  };
  const handleRemove = () => {
    onRemove(targetId);
  };

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <span
        className={cn(
          "w-24 shrink-0 truncate text-right font-mono text-xs",
          mapping ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {isLearningTarget ? "Move a control…" : formatMapping(mapping)}
      </span>
      {isLearningTarget ? (
        <Button
          className="h-7 w-14 animate-pulse text-xs"
          onClick={onStopLearn}
          size="sm"
          variant="destructive"
        >
          Cancel
        </Button>
      ) : (
        <Button
          className="h-7 w-14 text-xs"
          disabled={isLearning}
          onClick={handleStartLearn}
          size="sm"
          variant="outline"
        >
          Learn
        </Button>
      )}
      <Button
        aria-label={`Remove mapping for ${label}`}
        className="size-7"
        disabled={!mapping || isLearning}
        onClick={handleRemove}
        size="icon"
        variant="ghost"
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}

type MappingGroupProps = {
  title: string;
  targetIds: string[];
  actions: readonly MidiActionDescriptor[];
  mappings: readonly MidiMapping[];
  isLearning: boolean;
  learningTarget: string | null;
  onStartLearn: (targetId: string) => void;
  onStopLearn: () => void;
  onRemove: (targetId: string) => void;
};

function MappingGroup({
  title,
  targetIds,
  actions,
  mappings,
  isLearning,
  learningTarget,
  onStartLearn,
  onStopLearn,
  onRemove,
}: MappingGroupProps) {
  if (targetIds.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1">
      <h4 className="font-medium text-sm">{title}</h4>
      <div className="divide-y border-y">
        {targetIds.map((id) => {
          const action = actions.find((a) => a.targetId === id);
          if (!action) {
            return null;
          }
          const mapping = mappings.find((m) => m.targetId === id);
          return (
            <MappingRow
              isLearning={isLearning}
              isLearningTarget={learningTarget === id}
              key={id}
              label={action.label}
              mapping={mapping}
              onRemove={onRemove}
              onStartLearn={onStartLearn}
              onStopLearn={onStopLearn}
              targetId={id}
            />
          );
        })}
      </div>
    </div>
  );
}

export function MidiSettings() {
  const playerMode = usePlayerMode();
  const control = getMidiControl();
  const snapshot = useMidiControlSnapshot();
  const {
    actions,
    activePresetId,
    devices,
    enabled,
    learningTarget,
    mappings,
    status,
  } = snapshot;
  const isSupported = status !== "unsupported";
  const permissionGranted = status === "connected" || status === "granted";
  const isLoading = status === "connecting";

  const isLearning = learningTarget !== null;

  const deckATargets = actions
    .filter((a) => a.group === "deck-a")
    .map((a) => a.targetId);
  const deckBTargets = actions
    .filter((a) => a.group === "deck-b")
    .map((a) => a.targetId);
  const mixerTargets = actions
    .filter((a) => a.group === "mixer")
    .map((a) => a.targetId);
  const deckAEffectTargets = actions
    .filter((a) => a.group === "deck-a-effects")
    .map((a) => a.targetId);
  const deckBEffectTargets = actions
    .filter((a) => a.group === "deck-b-effects")
    .map((a) => a.targetId);

  const handleConnect = () => {
    control.connect().catch(() => undefined);
  };
  const handleEnabledChange = (nextEnabled: boolean) => {
    control.change({ enabled: nextEnabled, type: "set-enabled" });
  };
  const handlePresetChange = (presetId: string) => {
    control.change({ presetId, type: "load-preset" });
  };
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    if (!confirmClear) {
      return;
    }
    const handle = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(handle);
  }, [confirmClear]);
  const handleClearAllClick = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    handleClearMappings();
  };

  const handleClearMappings = () => {
    control.change({ type: "clear-mappings" });
  };
  const handleRemoveMapping = (targetId: string) => {
    control.change({ targetId, type: "remove-mapping" });
  };
  const handleStartLearn = (targetId: string) => {
    control.change({ targetId, type: "start-learn" });
  };
  const handleStopLearn = () => {
    control.change({ type: "stop-learn" });
  };

  if (!isSupported) {
    return (
      <Alert className="py-2.5">
        <InfoIcon />
        <AlertTitle>Web MIDI not supported</AlertTitle>
        <AlertDescription className="text-xs">
          MIDI controller support requires a Chromium-based browser (Chrome,
          Edge, Opera). Firefox and Safari do not support the Web MIDI API.
        </AlertDescription>
      </Alert>
    );
  }

  const connectedDevices = devices.filter((d) => d.state === "connected");

  return (
    <div className="space-y-5">
      {playerMode !== "dj" && (
        <Alert className="py-2.5">
          <InfoIcon />
          <AlertDescription className="text-xs">
            MIDI mappings are applied in DJ mode.
          </AlertDescription>
        </Alert>
      )}

      {!permissionGranted && (
        <Alert className="py-2.5">
          <InfoIcon />
          <AlertDescription className="text-xs">
            Grant MIDI permission to detect controllers and receive MIDI
            messages.
            <Button
              className="mt-1"
              disabled={isLoading}
              onClick={handleConnect}
              size="sm"
              variant="outline"
            >
              {isLoading ? "Requesting…" : "Grant MIDI permission"}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="divide-y border-y">
        <Field className={SETTING_ROW_CLASS} orientation="horizontal">
          <FieldLabel htmlFor="midi-enabled">Enable MIDI</FieldLabel>
          <Switch
            checked={enabled}
            id="midi-enabled"
            onCheckedChange={handleEnabledChange}
          />
        </Field>

        <Field className={SETTING_ROW_CLASS} orientation="horizontal">
          <FieldTitle>Connected devices</FieldTitle>
          <div className="flex min-w-0 items-start gap-2">
            {connectedDevices.length === 0 ? (
              <p className="min-w-0 flex-1 text-muted-foreground text-xs">
                No MIDI devices detected.
              </p>
            ) : (
              <div className="min-w-0 flex-1 divide-y">
                {connectedDevices.map((device) => (
                  <div
                    className="flex min-w-0 items-center gap-2 py-2 first:pt-0 last:pb-0"
                    key={device.id}
                  >
                    <CircleIcon className="size-2 shrink-0 fill-emerald-500 text-emerald-500" />
                    <span className="min-w-0 truncate text-sm">
                      {device.name}
                      {device.manufacturer ? (
                        <span className="ml-1 text-muted-foreground text-xs">
                          ({device.manufacturer})
                        </span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {permissionGranted ? (
              <Button
                aria-label="Refresh MIDI devices"
                className="shrink-0"
                disabled={isLoading}
                onClick={handleConnect}
                size="icon"
                title="Refresh MIDI devices"
                variant="outline"
              >
                <RefreshCwIcon
                  className={`size-3.5 ${isLoading ? "animate-spin" : ""}`}
                />
              </Button>
            ) : null}
          </div>
        </Field>

        <Field className={SETTING_ROW_CLASS} orientation="horizontal">
          <FieldTitle>Preset</FieldTitle>
          <Select
            onValueChange={handlePresetChange}
            value={activePresetId ?? undefined}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a preset…" />
            </SelectTrigger>
            <SelectContent>
              {MIDI_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name}
                  <span className="ml-1 text-muted-foreground text-xs">
                    ({preset.vendor})
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {/* Mapping table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-sm">Mappings</h4>
          <Button
            className="h-7 text-xs"
            disabled={mappings.length === 0 || isLearning}
            onClick={handleClearAllClick}
            size="sm"
            variant={confirmClear ? "destructive" : "ghost"}
          >
            <Trash2Icon className="size-3" />
            {confirmClear ? "Clear all mappings?" : "Clear all"}
          </Button>
        </div>

        <div className="grid gap-x-6 gap-y-5 lg:grid-cols-2 2xl:grid-cols-3">
          <MappingGroup
            actions={actions}
            isLearning={isLearning || !permissionGranted}
            learningTarget={learningTarget}
            mappings={mappings}
            onRemove={handleRemoveMapping}
            onStartLearn={handleStartLearn}
            onStopLearn={handleStopLearn}
            targetIds={deckATargets}
            title="Deck A"
          />

          <MappingGroup
            actions={actions}
            isLearning={isLearning || !permissionGranted}
            learningTarget={learningTarget}
            mappings={mappings}
            onRemove={handleRemoveMapping}
            onStartLearn={handleStartLearn}
            onStopLearn={handleStopLearn}
            targetIds={deckBTargets}
            title="Deck B"
          />

          <MappingGroup
            actions={actions}
            isLearning={isLearning || !permissionGranted}
            learningTarget={learningTarget}
            mappings={mappings}
            onRemove={handleRemoveMapping}
            onStartLearn={handleStartLearn}
            onStopLearn={handleStopLearn}
            targetIds={mixerTargets}
            title="Mixer"
          />

          <MappingGroup
            actions={actions}
            isLearning={isLearning || !permissionGranted}
            learningTarget={learningTarget}
            mappings={mappings}
            onRemove={handleRemoveMapping}
            onStartLearn={handleStartLearn}
            onStopLearn={handleStopLearn}
            targetIds={deckAEffectTargets}
            title="Deck A effects"
          />

          <MappingGroup
            actions={actions}
            isLearning={isLearning || !permissionGranted}
            learningTarget={learningTarget}
            mappings={mappings}
            onRemove={handleRemoveMapping}
            onStartLearn={handleStartLearn}
            onStopLearn={handleStopLearn}
            targetIds={deckBEffectTargets}
            title="Deck B effects"
          />
        </div>
      </div>
    </div>
  );
}
