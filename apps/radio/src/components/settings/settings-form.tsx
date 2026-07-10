import { Button } from "@avoid.quest/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@avoid.quest/ui/components/dialog";
import { DrawerClose } from "@avoid.quest/ui/components/drawer";
import { Slider } from "@avoid.quest/ui/components/slider";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@avoid.quest/ui/components/tabs";
import {
  DatabaseIcon,
  HeadphonesIcon,
  NetworkIcon,
  RadioIcon,
  RotateCcwIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";
import {
  type SettingsRecord,
  setRestoreStateOnLoad,
  setSingleModeTransitionDuration,
} from "@/lib/collections";
import { DEFAULT_TRANSITION_DURATION } from "@/lib/const";
import { useSettings } from "@/lib/hooks/use-settings";
import { resetAllSettings } from "@/lib/settings";
import { RadioManagement } from "./radio-management";
import { SettingsSelect } from "./settings-select";

const MAX_TRANSITION_DURATION = 10_000;

function handleRestoreStateToggle(checked: boolean): void {
  try {
    setRestoreStateOnLoad(checked);
  } catch {
    toast.error("Failed to update setting");
  }
}

const ImportExport = lazy(() =>
  import("./import-export").then((mod) => ({ default: mod.ImportExport }))
);

const AudioSettings = lazy(() =>
  import("./audio-settings").then((mod) => ({ default: mod.AudioSettings }))
);

const MidiSettings = lazy(() =>
  import("./midi-settings").then((mod) => ({ default: mod.MidiSettings }))
);

const RelaySettings = lazy(() =>
  import("./relay-settings").then((mod) => ({ default: mod.RelaySettings }))
);

const TAB_TRIGGER_CLASS =
  "h-7 flex-1 justify-start gap-1.5 px-2 text-[10px] font-mono uppercase tracking-wider md:w-full md:gap-2 md:text-xs";

export function SettingsForm({
  settings: passedSettings,
  defaultTab,
}: {
  settings?: SettingsRecord;
  defaultTab?: string;
}) {
  const { data: liveSettings } = useSettings();
  const settings = liveSettings || passedSettings;
  const [transitionDuration, setTransitionDuration] = useState(
    settings?.player.single?.transitionDuration ?? DEFAULT_TRANSITION_DURATION
  );
  const [isResetting, setIsResetting] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);

  const handleTransitionDurationChange = (value: number[]) => {
    const newValue = value[0];
    const previousValue = transitionDuration;
    setTransitionDuration(newValue ?? 0);

    if (!settings) {
      return;
    }

    try {
      setSingleModeTransitionDuration(newValue ?? 0);
    } catch {
      setTransitionDuration(previousValue);
      toast.error("Failed to update transition duration. Changes reverted.");
    }
  };

  const handleResetAllSettings = async () => {
    setIsResetting(true);
    try {
      await resetAllSettings();
      setShowResetDialog(false);
      toast.success("All settings reset to defaults");
    } catch {
      toast.error("Failed to reset all settings");
    } finally {
      setIsResetting(false);
    }
  };

  if (!settings) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider">
          Loading...
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[70vh] max-h-[85vh] flex-col gap-2 md:flex-row md:gap-3">
      <Tabs
        className="flex h-full w-full flex-col gap-3 md:flex-row"
        defaultValue={defaultTab ?? "radios"}
        orientation="vertical"
      >
        <TabsList className="flex h-auto w-full flex-row justify-start gap-1 bg-muted/30 p-1 md:min-h-[60vh] md:w-44 md:flex-col md:justify-start md:gap-1 md:p-1.5">
          <TabsTrigger className={TAB_TRIGGER_CLASS} value="radios">
            <RadioIcon className="size-3.5 shrink-0" />
            <span className="truncate">Radios</span>
          </TabsTrigger>
          <TabsTrigger className={TAB_TRIGGER_CLASS} value="player">
            <Settings2Icon className="size-3.5 shrink-0" />
            <span className="truncate">Player</span>
          </TabsTrigger>
          <TabsTrigger className={TAB_TRIGGER_CLASS} value="audio">
            <HeadphonesIcon className="size-3.5 shrink-0" />
            <span className="truncate">Audio</span>
          </TabsTrigger>
          <TabsTrigger className={TAB_TRIGGER_CLASS} value="midi">
            <SlidersHorizontalIcon className="size-3.5 shrink-0" />
            <span className="truncate">MIDI</span>
          </TabsTrigger>
          <TabsTrigger className={TAB_TRIGGER_CLASS} value="relays">
            <NetworkIcon className="size-3.5 shrink-0" />
            <span className="truncate">Relays</span>
          </TabsTrigger>
          <TabsTrigger className={TAB_TRIGGER_CLASS} value="import-export">
            <DatabaseIcon className="size-3.5 shrink-0" />
            <span className="truncate">Data</span>
          </TabsTrigger>
          <TabsTrigger
            className={`${TAB_TRIGGER_CLASS} text-destructive hover:text-destructive`}
            value="reset"
          >
            <RotateCcwIcon className="size-3.5 shrink-0" />
            <span className="truncate">Reset</span>
          </TabsTrigger>
          <span className="hidden font-mono text-[10px] text-muted-foreground/40 md:mt-auto md:block md:px-2 md:py-1">
            v{__APP_VERSION__}
          </span>
        </TabsList>

        <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border/50 bg-card/50">
          <TabsContent
            className="mt-0 flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto px-2 py-2 sm:p-3"
            value="radios"
          >
            <SectionHeader
              description="Manage your radio stations list."
              title="Radios"
            />
            <RadioManagement />
          </TabsContent>

          <TabsContent
            className="mt-0 flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto p-3"
            value="player"
          >
            <SectionHeader
              description="Customize playback behavior."
              title="Player"
            />
            <div className="space-y-4">
              <SettingsSelect />

              <div className="space-y-2 rounded-lg border border-border/50 p-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <label className="text-sm" htmlFor="restore-state">
                      Restore playback state on load
                    </label>
                    <p className="text-[10px] text-muted-foreground/60">
                      Remember last played radio and volume settings
                    </p>
                  </div>
                  <input
                    checked={settings.player.restoreStateOnLoad !== false}
                    className="size-4 cursor-pointer accent-primary"
                    id="restore-state"
                    onChange={(e) => handleRestoreStateToggle(e.target.checked)}
                    type="checkbox"
                  />
                </div>
              </div>

              {settings.player.mode === "single" && (
                <div className="space-y-2 rounded-lg border border-border/50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Transition Duration</span>
                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                      {(transitionDuration / 1000).toFixed(1)}s
                    </span>
                  </div>
                  <Slider
                    className="h-1.5 w-full"
                    defaultValue={[DEFAULT_TRANSITION_DURATION]}
                    max={MAX_TRANSITION_DURATION}
                    onValueChange={handleTransitionDurationChange}
                    step={100}
                    value={[transitionDuration]}
                  />
                  <p className="text-[10px] text-muted-foreground/60">
                    Crossfade duration between tracks.
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent
            className="mt-0 flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto p-3"
            value="audio"
          >
            <SectionHeader
              description="Configure shared output routing and DJ monitoring."
              title="Audio"
            />
            <Suspense fallback={<LoadingFallback />}>
              <AudioSettings />
            </Suspense>
          </TabsContent>

          <TabsContent
            className="mt-0 flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto p-3"
            value="midi"
          >
            <SectionHeader
              description="Connect and configure MIDI controllers for DJ mode."
              title="MIDI"
            />
            <Suspense fallback={<LoadingFallback />}>
              <MidiSettings />
            </Suspense>
          </TabsContent>

          <TabsContent
            className="mt-0 flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto p-3"
            value="relays"
          >
            <SectionHeader
              description="Configure trusted external audio data planes."
              title="Relays"
            />
            <Suspense fallback={<LoadingFallback />}>
              <RelaySettings />
            </Suspense>
          </TabsContent>

          <TabsContent
            className="mt-0 flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto p-3"
            value="import-export"
          >
            <SectionHeader
              description="Import or export your settings and radios."
              title="Data"
            />
            <Suspense fallback={<LoadingFallback />}>
              <ImportExport />
            </Suspense>
          </TabsContent>

          <TabsContent
            className="mt-0 flex min-h-0 flex-1 flex-col space-y-3 overflow-y-auto p-3"
            value="reset"
          >
            <SectionHeader
              description="Reset application to factory defaults."
              title="Reset"
            />
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
              <div className="space-y-3">
                <p className="text-muted-foreground text-xs">
                  This will reset all settings and radio stations to their
                  default values. All your customizations will be lost. This
                  action cannot be undone.
                </p>
                <Dialog
                  onOpenChange={setShowResetDialog}
                  open={showResetDialog}
                >
                  <DialogTrigger asChild>
                    <Button size="sm" variant="destructive">
                      Reset All Settings
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Reset All Settings</DialogTitle>
                      <DialogDescription>
                        Are you sure you want to reset all settings and radio
                        stations to their default values? This will clear all
                        your customizations. This action cannot be undone.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="text-muted-foreground text-xs">
                      <p className="mb-2">This will clear:</p>
                      <ul className="list-disc space-y-1 pl-5">
                        <li>All player settings</li>
                        <li>All radio station customizations</li>
                        <li>Radio station order and enabled/disabled states</li>
                      </ul>
                    </div>
                    <DialogFooter>
                      <Button
                        disabled={isResetting}
                        onClick={() => setShowResetDialog(false)}
                        size="sm"
                        variant="outline"
                      >
                        Cancel
                      </Button>
                      <Button
                        disabled={isResetting}
                        onClick={handleResetAllSettings}
                        size="sm"
                        variant="destructive"
                      >
                        {isResetting ? "Resetting..." : "Reset All Settings"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </TabsContent>
        </div>
      </Tabs>

      <div className="flex w-full justify-center pt-2 md:hidden">
        <DrawerClose asChild>
          <Button className="w-full" size="sm" variant="outline">
            Close
          </Button>
        </DrawerClose>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-1">
      <h3 className="font-mono text-foreground/80 text-xs uppercase tracking-wider">
        {title}
      </h3>
      <p className="text-[10px] text-muted-foreground/60">{description}</p>
    </div>
  );
}

function LoadingFallback() {
  return (
    <p className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider">
      Loading...
    </p>
  );
}
