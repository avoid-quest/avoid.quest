"use client";

import { Button } from "@workspace/ui/components/button";
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
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger className="text-xs sm:text-sm" value="radios">
            Radios
          </TabsTrigger>
          <TabsTrigger className="text-xs sm:text-sm" value="player">
            Player
          </TabsTrigger>
          <TabsTrigger className="text-xs sm:text-sm" value="import-export">
            Data
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
