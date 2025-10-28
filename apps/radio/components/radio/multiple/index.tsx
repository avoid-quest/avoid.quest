"use client";

import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Volume2 } from "lucide-react";
import { useState } from "react";
import type { Radio } from "@/lib/types";
import { RadioDialog } from "../../settings/radio-dialog";
import { SettingsButton } from "../../settings/settings-button";
import { RadioComponent } from "../radio-component";

export function MultipleRadios({ radios }: { radios?: Radio[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [selectedRadio, setSelectedRadio] = useState<Radio | undefined>();
  const [deleteConfirm, setDeleteConfirm] = useState<Radio | null>(null);

  const handleEditRadio = (radio: Radio) => {
    setDialogMode("edit");
    setSelectedRadio(radio);
    setDialogOpen(true);
  };

  const handleDeleteRadio = (radio: Radio) => {
    setDeleteConfirm(radio);
  };

  const handleToggleRadio = async (_radio: Radio, _enabled: boolean) => {
    // This will be handled by RadioItemActions component
    // No need to implement here as it's handled in the actions component
  };

  const confirmDelete = async () => {
    if (!deleteConfirm?.id) {
      return;
    }

    try {
      const { db } = await import("@/lib/db");
      await db.radios.delete(deleteConfirm.id);
      setDeleteConfirm(null);
    } catch (error) {
      console.error("Failed to delete radio:", error);
    }
  };

  if (!radios || radios.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center">
              No Radio Stations Available
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <Volume2 className="mx-auto mb-4 size-12 text-muted-foreground" />
            <p className="mb-4 text-muted-foreground text-sm">
              All radio stations are currently disabled. Please enable some
              stations in the settings.
            </p>
            <SettingsButton />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-center gap-4">
        <h2 className="font-medium text-lg">Radio Stations</h2>
        <SettingsButton />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4">
        {radios.map((radio: Radio) => (
          <RadioComponent
            key={radio.id}
            onDelete={handleDeleteRadio}
            onEdit={handleEditRadio}
            onToggle={handleToggleRadio}
            radio={radio}
          />
        ))}
      </div>

      <RadioDialog
        mode={dialogMode}
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        radio={selectedRadio}
      />

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="max-w-md rounded-lg border bg-background p-6">
            <h3 className="mb-2 font-semibold text-lg">Delete Radio Station</h3>
            <p className="mb-4 text-muted-foreground">
              Are you sure you want to delete "{deleteConfirm.name}"? This
              action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setDeleteConfirm(null)} variant="outline">
                Cancel
              </Button>
              <Button onClick={confirmDelete} variant="destructive">
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
