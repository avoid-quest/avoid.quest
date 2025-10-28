"use client";

import { Button } from "@workspace/ui/components/button";
import { FileText, Wand2 } from "lucide-react";

type RadioAddModeSelectorProps = {
  onModeChange: (mode: "guided" | "manual") => void;
};

export function RadioAddModeSelector({
  onModeChange,
}: RadioAddModeSelectorProps) {
  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="space-y-2 text-center">
        <h3 className="font-semibold text-lg">Add a Radio Station</h3>
        <p className="text-muted-foreground">
          Choose how you'd like to add your radio station
        </p>
      </div>

      {/* Mode Selection */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Guided Mode */}
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <Wand2 className="size-5" />
              </div>
              <div>
                <h4 className="font-semibold text-lg">Guided Mode</h4>
                <p className="text-muted-foreground text-xs">Recommended</p>
              </div>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Simply paste the radio station's website URL and we'll
              automatically find the stream URL, logo, and other details for
              you. Perfect for most radio stations.
            </p>
          </div>
          <Button className="w-full" onClick={() => onModeChange("guided")}>
            Start Guided Setup
          </Button>
        </div>

        {/* Manual Mode */}
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-muted p-2 text-muted-foreground">
                <FileText className="size-5" />
              </div>
              <div>
                <h4 className="font-semibold text-lg">Manual Mode</h4>
                <p className="text-muted-foreground text-xs">Full Control</p>
              </div>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Manually enter all radio station details including stream URL,
              logo, and description. Use this when you have specific
              requirements.
            </p>
          </div>
          <Button className="w-full" onClick={() => onModeChange("manual")}>
            Start Manual Setup
          </Button>
        </div>
      </div>

      {/* Helpful Tip */}
      <div className="text-center">
        <p className="text-muted-foreground text-xs">
          <strong>Tip:</strong> Guided mode works best with official radio
          station websites
        </p>
      </div>
    </div>
  );
}
