/**
 * MIDI Settings UI
 *
 * Connected device list, preset selector, mapping table with learn mode.
 */

import { Button } from "@avoid.quest/ui/components/button";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { cn } from "@avoid.quest/ui/lib/utils";
import { CircleIcon, Trash2Icon, XIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  MIDI_PRESETS,
  type MidiAction,
  MidiController,
  type MidiMapping,
  useMidiStore,
} from "@/lib/midi";

const EMPTY_ACTIONS: MidiAction[] = [];

function useActions(): MidiAction[] {
  const controller = MidiController.getInstance();
  return useSyncExternalStore(
    (cb) => controller.subscribeActions(cb),
    () => controller.getAllActions(),
    () => EMPTY_ACTIONS
  );
}

function formatMapping(mapping: MidiMapping | undefined): string {
  if (!mapping) {
    return "Not mapped";
  }
  const typeLabel = mapping.type === "cc" ? "CC" : "Note";
  const transformInfo = mapping.transform
    ? ` ${mapping.transform.invert ? "INV " : ""}${mapping.transform.curve !== "linear" ? mapping.transform.curve : ""}`
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
          "w-28 shrink-0 truncate text-right font-mono text-xs",
          mapping ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {formatMapping(mapping)}
      </span>
      {isLearningTarget ? (
        <Button
          className="h-7 w-16 animate-pulse text-xs"
          onClick={onStopLearn}
          size="sm"
          variant="destructive"
        >
          Cancel
        </Button>
      ) : (
        <Button
          className="h-7 w-16 text-xs"
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
  actions: MidiAction[];
  mappings: MidiMapping[];
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
      <div className="rounded-lg border border-border/50 bg-card/50 px-3 py-1">
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
  const isSupported = useMidiStore((s) => s.isSupported);
  const devices = useMidiStore((s) => s.devices);
  const mappings = useMidiStore((s) => s.mappings);
  const activePresetId = useMidiStore((s) => s.activePresetId);
  const learningTarget = useMidiStore((s) => s.learningTarget);
  const enabled = useMidiStore((s) => s.enabled);
  const startLearn = useMidiStore((s) => s.startLearn);
  const stopLearn = useMidiStore((s) => s.stopLearn);
  const loadPreset = useMidiStore((s) => s.loadPreset);
  const clearMappings = useMidiStore((s) => s.clearMappings);
  const removeMapping = useMidiStore((s) => s.removeMapping);
  const setEnabled = useMidiStore((s) => s.setEnabled);

  const isLearning = learningTarget !== null;

  const actions = useActions();
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
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-5 pr-3">
        {/* Enable toggle */}
        <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
          <div className="space-y-0.5">
            <label className="text-sm" htmlFor="midi-enabled">
              Enable MIDI
            </label>
            <p className="text-[10px] text-muted-foreground/60">
              Receive MIDI messages from connected controllers
            </p>
          </div>
          <input
            checked={enabled}
            className="size-4 cursor-pointer accent-primary"
            id="midi-enabled"
            onChange={(e) => setEnabled(e.target.checked)}
            type="checkbox"
          />
        </div>

        {/* Connected devices */}
        <div className="space-y-2">
          <h4 className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
            Connected Devices
          </h4>
          {connectedDevices.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/60">
              No MIDI devices detected. Connect a controller and it will appear
              here.
            </p>
          ) : (
            <div className="space-y-1">
              {connectedDevices.map((device) => (
                <div
                  className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/50 px-3 py-2"
                  key={device.id}
                >
                  <CircleIcon className="size-2.5 fill-emerald-500 text-emerald-500" />
                  <span className="flex-1 text-sm">
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
        </div>

        {/* Preset selector */}
        <div className="space-y-2">
          <h4 className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
            Preset
          </h4>
          <div className="flex items-center gap-2">
            <Select
              onValueChange={loadPreset}
              value={activePresetId ?? undefined}
            >
              <SelectTrigger className="flex-1">
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
          <p className="text-[10px] text-muted-foreground/60">
            Load a preset for your controller, or use Learn to map controls
            manually.
          </p>
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
              onClick={clearMappings}
              size="sm"
              variant="ghost"
            >
              <Trash2Icon className="mr-1.5 size-3" />
              Clear All
            </Button>
          </div>

          <MappingGroup
            actions={actions}
            isLearning={isLearning}
            learningTarget={learningTarget}
            mappings={mappings}
            onRemove={removeMapping}
            onStartLearn={startLearn}
            onStopLearn={stopLearn}
            targetIds={deckATargets}
            title="Deck A"
          />

          <MappingGroup
            actions={actions}
            isLearning={isLearning}
            learningTarget={learningTarget}
            mappings={mappings}
            onRemove={removeMapping}
            onStartLearn={startLearn}
            onStopLearn={stopLearn}
            targetIds={deckBTargets}
            title="Deck B"
          />

          <MappingGroup
            actions={actions}
            isLearning={isLearning}
            learningTarget={learningTarget}
            mappings={mappings}
            onRemove={removeMapping}
            onStartLearn={startLearn}
            onStopLearn={stopLearn}
            targetIds={mixerTargets}
            title="Mixer"
          />

          <MappingGroup
            actions={actions}
            isLearning={isLearning}
            learningTarget={learningTarget}
            mappings={mappings}
            onRemove={removeMapping}
            onStartLearn={startLearn}
            onStopLearn={stopLearn}
            targetIds={deckAEffectTargets}
            title="Deck A Effects"
          />

          <MappingGroup
            actions={actions}
            isLearning={isLearning}
            learningTarget={learningTarget}
            mappings={mappings}
            onRemove={removeMapping}
            onStartLearn={startLearn}
            onStopLearn={stopLearn}
            targetIds={deckBEffectTargets}
            title="Deck B Effects"
          />
        </div>
      </div>
    </ScrollArea>
  );
}
