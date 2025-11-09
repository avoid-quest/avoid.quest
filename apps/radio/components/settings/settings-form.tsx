"use client";

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
import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "sonner";
import { DEFAULT_TRANSITION_DURATION } from "@/lib/const";
import { db } from "@/lib/db";
import { resetAllSettings } from "@/lib/settings";
import type { Settings } from "@/lib/types";
import { RadioManagement } from "./radio-management";
import { SettingsSelect } from "./settings-select";

const MAX_TRANSITION_DURATION = 10_000;

// Dynamic import with SSR disabled for browser-only APIs
const ImportExport = dynamic(
  () => import("./import-export").then((mod) => mod.ImportExport),
  {
    ssr: false,
  }
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
      console.error("Failed to update transition duration:", error);
      toast.error("Failed to update transition duration");
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
    <div className="w-full space-y-4">
      <Tabs className="w-full" defaultValue="radios">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger className="text-xs sm:text-sm" value="radios">
            Radios
          </TabsTrigger>
          <TabsTrigger className="text-xs sm:text-sm" value="player">
            Player
          </TabsTrigger>
          <TabsTrigger className="text-xs sm:text-sm" value="import-export">
            Data
          </TabsTrigger>
          <TabsTrigger className="text-xs sm:text-sm" value="reset">
            Reset
          </TabsTrigger>
        </TabsList>

        <TabsContent className="space-y-4" value="radios">
          <RadioManagement />
        </TabsContent>

        <TabsContent className="space-y-4" value="player">
          <div className="space-y-4">
            <div className="space-y-3">
              <h3 className="font-medium text-sm">Player Settings</h3>
              <SettingsSelect />

              {settings.player.mode === "single" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">
                      Transition Duration
                    </span>
                    <span className="text-muted-foreground text-sm">
                      {(transitionDuration / MAX_TRANSITION_DURATION).toFixed(
                        2
                      )}
                      s
                    </span>
                  </div>
                  <Slider
                    className="w-full"
                    max={MAX_TRANSITION_DURATION}
                    onValueChange={handleTransitionDurationChange}
                    step={10}
                    value={[transitionDuration]}
                  />
                  <p className="text-muted-foreground text-xs">
                    Time to fade between radio stations
                  </p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent className="space-y-4" value="import-export">
          <ImportExport />
        </TabsContent>

        <TabsContent className="space-y-4" value="reset">
          <div className="space-y-4">
            <div className="space-y-3">
              <h3 className="font-medium text-sm">Reset All Settings</h3>
              <p className="text-muted-foreground text-sm">
                This will reset all settings and radio stations to their default
                values. All your customizations will be lost. This action cannot
                be undone.
              </p>
              <Dialog onOpenChange={setShowResetDialog} open={showResetDialog}>
                <DialogTrigger asChild>
                  <Button className="w-full" variant="destructive">
                    Reset All Settings
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Reset All Settings</DialogTitle>
                    <DialogDescription>
                      Are you sure you want to reset all settings and radio
                      stations to their default values? This will clear all your
                      customizations. This action cannot be undone.
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
      </Tabs>

      <div className="flex w-full justify-center pt-2">
        <DrawerClose asChild>
          <Button className="w-full sm:w-auto" variant="outline">
            Close
          </Button>
        </DrawerClose>
      </div>
    </div>
  );
}
