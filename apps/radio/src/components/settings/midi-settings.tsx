/**
 * MIDI Settings UI
 *
 * Connected device list, preset selector, mapping table with learn mode.
 */

import { Alert, AlertDescription } from "@avoid.quest/ui/components/alert";
import { Button } from "@avoid.quest/ui/components/button";
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
import { useMidiControlSnapshot } from "@/lib/hooks/use-midi";
import { usePlayerMode } from "@/lib/hooks/use-settings";
import {
  getMidiControl,
  MIDI_PRESETS,
  type MidiActionDescriptor,
  type MidiMapping,
} from "@/lib/midi";

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
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <span
        className={cn(
          "w-24 shrink-0 truncate text-right font-mono text-xs",
          mapping ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {formatMapping(mapping)}
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
          onClick={() => onStartLearn(targetId)}
          size="sm"
          variant="outline"
        >
          Learn
        </Button>
      )}
      <Button
        className="h-7 w-7 p-0"
        disabled={!mapping || isLearning}
        onClick={() => onRemove(targetId)}
        size="sm"
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
      <h4 className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider">
        {title}
      </h4>
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

  const requestPermission = () => {
    control.connect().catch(() => undefined);
  };
  const refreshDevices = () => {
    control.connect().catch(() => undefined);
  };

  if (!isSupported) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
          <p className="font-mono text-xs uppercase tracking-wider">
            Web MIDI not supported
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground/60">
            MIDI controller support requires a Chromium-based browser (Chrome,
            Edge, Opera). Firefox and Safari do not support the Web MIDI API.
          </p>
        </div>
      </div>
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
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
          <p className="mb-2 text-xs">
            Grant MIDI permission to detect controllers and receive MIDI
            messages.
          </p>
          <Button
            disabled={isLoading}
            onClick={requestPermission}
            size="sm"
            variant="outline"
          >
            {isLoading ? "Requesting..." : "Grant MIDI Permission"}
          </Button>
        </div>
      )}

      <div className="divide-y border-y">
        <div className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(18rem,28rem)] sm:items-center">
          <label className="text-sm" htmlFor="midi-enabled">
            Enable MIDI
          </label>
          <Switch
            checked={enabled}
            id="midi-enabled"
            onCheckedChange={(nextEnabled) =>
              control.change({ type: "set-enabled", enabled: nextEnabled })
            }
          />
        </div>

        <div className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(18rem,28rem)] sm:items-start">
          <h4 className="text-sm">Connected devices</h4>
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
                      {device.manufacturer && (
                        <span className="ml-1 text-muted-foreground text-xs">
                          ({device.manufacturer})
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {permissionGranted && (
              <Button
                aria-label="Refresh MIDI devices"
                className="shrink-0"
                disabled={isLoading}
                onClick={refreshDevices}
                size="icon"
                title="Refresh MIDI devices"
                variant="outline"
              >
                <RefreshCwIcon
                  className={`size-3.5 ${isLoading ? "animate-spin" : ""}`}
                />
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(18rem,28rem)] sm:items-center">
          <h4 className="text-sm">Preset</h4>
          <Select
            onValueChange={(presetId) =>
              control.change({ type: "load-preset", presetId })
            }
            value={activePresetId ?? undefined}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a preset..." />
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
        </div>
      </div>

      {/* Mapping table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
            Mappings
          </h4>
          <Button
            className="h-7 text-xs"
            disabled={mappings.length === 0 || isLearning}
            onClick={() => control.change({ type: "clear-mappings" })}
            size="sm"
            variant="ghost"
          >
            <Trash2Icon className="mr-1.5 size-3" />
            Clear All
          </Button>
        </div>

        <div className="grid gap-x-6 gap-y-5 lg:grid-cols-2 2xl:grid-cols-3">
          <MappingGroup
            actions={actions}
            isLearning={isLearning}
            learningTarget={learningTarget}
            mappings={mappings}
            onRemove={(targetId) =>
              control.change({ type: "remove-mapping", targetId })
            }
            onStartLearn={(targetId) =>
              control.change({ type: "start-learn", targetId })
            }
            onStopLearn={() => control.change({ type: "stop-learn" })}
            targetIds={deckATargets}
            title="Deck A"
          />

          <MappingGroup
            actions={actions}
            isLearning={isLearning}
            learningTarget={learningTarget}
            mappings={mappings}
            onRemove={(targetId) =>
              control.change({ type: "remove-mapping", targetId })
            }
            onStartLearn={(targetId) =>
              control.change({ type: "start-learn", targetId })
            }
            onStopLearn={() => control.change({ type: "stop-learn" })}
            targetIds={deckBTargets}
            title="Deck B"
          />

          <MappingGroup
            actions={actions}
            isLearning={isLearning}
            learningTarget={learningTarget}
            mappings={mappings}
            onRemove={(targetId) =>
              control.change({ type: "remove-mapping", targetId })
            }
            onStartLearn={(targetId) =>
              control.change({ type: "start-learn", targetId })
            }
            onStopLearn={() => control.change({ type: "stop-learn" })}
            targetIds={mixerTargets}
            title="Mixer"
          />

          <MappingGroup
            actions={actions}
            isLearning={isLearning}
            learningTarget={learningTarget}
            mappings={mappings}
            onRemove={(targetId) =>
              control.change({ type: "remove-mapping", targetId })
            }
            onStartLearn={(targetId) =>
              control.change({ type: "start-learn", targetId })
            }
            onStopLearn={() => control.change({ type: "stop-learn" })}
            targetIds={deckAEffectTargets}
            title="Deck A Effects"
          />

          <MappingGroup
            actions={actions}
            isLearning={isLearning}
            learningTarget={learningTarget}
            mappings={mappings}
            onRemove={(targetId) =>
              control.change({ type: "remove-mapping", targetId })
            }
            onStartLearn={(targetId) =>
              control.change({ type: "start-learn", targetId })
            }
            onStopLearn={() => control.change({ type: "stop-learn" })}
            targetIds={deckBEffectTargets}
            title="Deck B Effects"
          />
        </div>
      </div>
    </div>
  );
}
