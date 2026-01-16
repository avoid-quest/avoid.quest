import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import { DrawerClose } from "@workspace/ui/components/drawer";
import { Slider } from "@workspace/ui/components/slider";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { useLiveQuery } from "dexie-react-hooks";
import {
  DatabaseIcon,
  RadioIcon,
  RotateCcwIcon,
  Settings2Icon,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_TRANSITION_DURATION } from "@/lib/const";
import { db } from "@/lib/db";
import { resetAllSettings } from "@/lib/settings";
import type { Settings } from "@/lib/types";
import { RadioManagement } from "./radio-management";
import { SettingsSelect } from "./settings-select";

const MAX_TRANSITION_DURATION = 10_000;

// Lazy import for browser-only APIs (Dexie operations)
const ImportExport = lazy(() =>
  import("./import-export").then((mod) => ({ default: mod.ImportExport }))
);

export function SettingsForm({
  settings: passedSettings,
}: {
  settings?: Settings;
}) {
  const settings =
    useLiveQuery(() => db.settings.limit(1).toArray())?.[0] || passedSettings;
  const [transitionDuration, setTransitionDuration] = useState(
    settings?.player.single?.transitionDuration ?? DEFAULT_TRANSITION_DURATION
  );
  const [isResetting, setIsResetting] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);

  const handleTransitionDurationChange = async (value: number[]) => {
    const newValue = value[0];
    // Store previous value for rollback on error
    const previousValue = transitionDuration;
    // Optimistically update the UI
    setTransitionDuration(newValue ?? 0);

    if (!settings?.id) {
      return;
    }

    try {
      await db.settings.update(settings.id, {
        player: {
          ...settings.player,
          single: {
            transitionDuration: newValue ?? 0,
            lastUsedRadio: settings.player.single?.lastUsedRadio,
          },
        },
      });
    } catch (error) {
      // Rollback to previous value on error
      setTransitionDuration(previousValue);
      console.error("Failed to update transition duration:", error);
      toast.error("Failed to update transition duration. Changes reverted.");
    }
  };

  const handleResetAllSettings = async () => {
    setIsResetting(true);
    try {
      await resetAllSettings();
      setShowResetDialog(false);
      toast.success("All settings reset to defaults");
    } catch (error) {
      console.error("Failed to reset all settings:", error);
      toast.error("Failed to reset all settings");
    } finally {
      setIsResetting(false);
    }
  };

  if (!settings) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-muted-foreground text-sm">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="flex h-[70vh] max-h-[85vh] flex-col gap-2 md:flex-row md:gap-4">
      <Tabs
        className="flex h-full w-full flex-col gap-4 md:flex-row"
        defaultValue="radios"
        orientation="vertical"
      >
        <TabsList className="flex h-auto w-full flex-row justify-start gap-1 bg-muted/50 p-1.5 md:min-h-[60vh] md:w-48 md:flex-col md:justify-start md:gap-2 md:p-2">
          <TabsTrigger
            className="flex-1 justify-start gap-1.5 text-xs md:w-full md:gap-2 md:text-sm"
            value="radios"
          >
            <RadioIcon className="size-4 shrink-0" />
            <span className="truncate">Radios</span>
          </TabsTrigger>
          <TabsTrigger
            className="flex-1 justify-start gap-1.5 text-xs md:w-full md:gap-2 md:text-sm"
            value="player"
          >
            <Settings2Icon className="size-4 shrink-0" />
            <span className="truncate">Player</span>
          </TabsTrigger>
          <TabsTrigger
            className="flex-1 justify-start gap-1.5 text-xs md:w-full md:gap-2 md:text-sm"
            value="import-export"
          >
            <DatabaseIcon className="size-4 shrink-0" />
            <span className="truncate">Data</span>
          </TabsTrigger>
          <TabsTrigger
            className="flex-1 justify-start gap-1.5 text-destructive text-xs hover:text-destructive md:w-full md:gap-2 md:text-sm"
            value="reset"
          >
            <RotateCcwIcon className="size-4 shrink-0" />
            <span className="truncate">Reset</span>
          </TabsTrigger>
        </TabsList>

        <div className="flex min-h-0 flex-1 flex-col rounded-lg border bg-card shadow-sm">
          <TabsContent
            className="mt-0 flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto px-2 py-1 sm:p-4"
            value="radios"
          >
            <div className="mb-4">
              <h3 className="font-medium sm:text-lg">Radio Stations</h3>
              <p className="text-muted-foreground text-xs sm:text-sm">
                Manage your radio stations list.
              </p>
            </div>
            <RadioManagement />
          </TabsContent>

          <TabsContent
            className="mt-0 flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto p-4"
            value="player"
          >
            <div className="mb-4">
              <h3 className="font-medium text-lg">Player Preferences</h3>
              <p className="text-muted-foreground text-sm">
                Customize your listening experience.
              </p>
            </div>
            <div className="space-y-6">
              <div className="space-y-3">
                <h4 className="font-medium text-sm">Playback Mode</h4>
                <SettingsSelect />
              </div>

              {settings.player.mode === "single" && (
                <div className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">
                      Transition Duration
                    </span>
                    <span className="font-mono text-muted-foreground text-sm">
                      {(transitionDuration / 1000).toFixed(1)}s
                    </span>
                  </div>
                  <Slider
                    className="w-full"
                    max={MAX_TRANSITION_DURATION}
                    onValueChange={handleTransitionDurationChange}
                    step={100}
                    value={[transitionDuration]}
                  />
                  <p className="text-muted-foreground text-xs">
                    Adjust the crossfade duration between tracks.
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent
            className="mt-0 flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto p-4"
            value="import-export"
          >
            <div className="mb-4">
              <h3 className="font-medium text-lg">Data Management</h3>
              <p className="text-muted-foreground text-sm">
                Import or export your settings and radios.
              </p>
            </div>
            <Suspense
              fallback={
                <div className="text-muted-foreground text-sm">Loading...</div>
              }
            >
              <ImportExport />
            </Suspense>
          </TabsContent>

          <TabsContent
            className="mt-0 flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto p-4"
            value="reset"
          >
            <div className="mb-4">
              <h3 className="font-medium text-destructive text-lg">
                Danger Zone
              </h3>
              <p className="text-muted-foreground text-sm">
                Reset application to factory defaults.
              </p>
            </div>
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
              <div className="space-y-3">
                <h4 className="font-medium text-destructive text-sm">
                  Reset All Settings
                </h4>
                <p className="text-muted-foreground text-sm">
                  This will reset all settings and radio stations to their
                  default values. All your customizations will be lost. This
                  action cannot be undone.
                </p>
                <Dialog
                  onOpenChange={setShowResetDialog}
                  open={showResetDialog}
                >
                  <DialogTrigger asChild>
                    <Button variant="destructive">Reset All Settings</Button>
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
                    <div className="text-muted-foreground text-sm">
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
                        variant="outline"
                      >
                        Cancel
                      </Button>
                      <Button
                        disabled={isResetting}
                        onClick={handleResetAllSettings}
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
          <Button className="w-full" variant="outline">
            Close
          </Button>
        </DrawerClose>
      </div>
    </div>
  );
}
