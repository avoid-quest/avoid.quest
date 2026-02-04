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
import { useMidi } from "@/lib/hooks/use-midi";
import { getMidiActions, MIDI_PRESETS, type MidiMapping } from "@/lib/midi";

function formatMapping(mapping: MidiMapping | undefined): string {
  if (!mapping) {
    return "Not mapped";
  }
  const typeLabel = mapping.type === "cc" ? "CC" : "Note";
  return `${typeLabel} ${mapping.control} ch.${mapping.channel + 1}`;
}

type MappingRowProps = {
  actionId: string;
  label: string;
  mapping: MidiMapping | undefined;
  isLearning: boolean;
  isLearningTarget: boolean;
  onStartLearn: (actionId: string) => void;
  onStopLearn: () => void;
  onRemove: (actionId: string) => void;
};

function MappingRow({
  actionId,
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
          onClick={() => onStartLearn(actionId)}
          size="sm"
          variant="outline"
        >
          Learn
        </Button>
      )}
      <Button
        className="h-7 w-7 p-0"
        disabled={!mapping || isLearning}
        onClick={() => onRemove(actionId)}
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
  actionIds: string[];
  actions: ReturnType<typeof getMidiActions>;
  mappings: MidiMapping[];
  isLearning: boolean;
  learningTarget: string | null;
  onStartLearn: (actionId: string) => void;
  onStopLearn: () => void;
  onRemove: (actionId: string) => void;
};

function MappingGroup({
  title,
  actionIds,
  actions,
  mappings,
  isLearning,
  learningTarget,
  onStartLearn,
  onStopLearn,
  onRemove,
}: MappingGroupProps) {
  return (
    <div className="space-y-1">
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {title}
      </h4>
      <div className="rounded-lg border bg-muted/30 px-3 py-1">
        {actionIds.map((id) => {
          const action = actions.find((a) => a.id === id);
          if (!action) {
            return null;
          }
          const mapping = mappings.find((m) => m.actionId === id);
          return (
            <MappingRow
              actionId={id}
              isLearning={isLearning}
              isLearningTarget={learningTarget === id}
              key={id}
              label={action.label}
              mapping={mapping}
              onRemove={onRemove}
              onStartLearn={onStartLearn}
              onStopLearn={onStopLearn}
            />
          );
        })}
      </div>
    </div>
  );
}

export function MidiSettings() {
  const {
    isSupported,
    devices,
    mappings,
    activePresetId,
    isLearning,
    learningTarget,
    enabled,
    startLearn,
    stopLearn,
    loadPreset,
    clearMappings,
    removeMapping,
    setEnabled,
  } = useMidi();

  const actions = getMidiActions();
  const deckAActions = actions
    .filter((a) => a.group === "deck-a")
    .map((a) => a.id);
  const deckBActions = actions
    .filter((a) => a.group === "deck-b")
    .map((a) => a.id);
  const mixerActions = actions
    .filter((a) => a.group === "mixer")
    .map((a) => a.id);

  if (!isSupported) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
          <p className="font-medium text-sm">Web MIDI not supported</p>
          <p className="mt-1 text-muted-foreground text-xs">
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
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="space-y-0.5">
            <label className="font-medium text-sm" htmlFor="midi-enabled">
              Enable MIDI
            </label>
            <p className="text-muted-foreground text-xs">
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
          <h4 className="font-medium text-sm">Connected Devices</h4>
          {connectedDevices.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No MIDI devices detected. Connect a controller and it will appear
              here.
            </p>
          ) : (
            <div className="space-y-1">
              {connectedDevices.map((device) => (
                <div
                  className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2"
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
          <h4 className="font-medium text-sm">Preset</h4>
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
          <p className="text-muted-foreground text-xs">
            Load a preset for your controller, or use Learn to map controls
            manually.
          </p>
        </div>

        {/* Mapping table */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Mappings</h4>
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
            actionIds={deckAActions}
            actions={actions}
            isLearning={isLearning}
            learningTarget={learningTarget}
            mappings={mappings}
            onRemove={removeMapping}
            onStartLearn={startLearn}
            onStopLearn={stopLearn}
            title="Deck A"
          />

          <MappingGroup
            actionIds={deckBActions}
            actions={actions}
            isLearning={isLearning}
            learningTarget={learningTarget}
            mappings={mappings}
            onRemove={removeMapping}
            onStartLearn={startLearn}
            onStopLearn={stopLearn}
            title="Deck B"
          />

          <MappingGroup
            actionIds={mixerActions}
            actions={actions}
            isLearning={isLearning}
            learningTarget={learningTarget}
            mappings={mappings}
            onRemove={removeMapping}
            onStartLearn={startLearn}
            onStopLearn={stopLearn}
            title="Mixer"
          />
        </div>
      </div>
    </ScrollArea>
  );
}
