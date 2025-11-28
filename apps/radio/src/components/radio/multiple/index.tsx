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
      <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl items-center justify-center px-4 py-4">
        <Card className="w-full max-w-md border-dashed">
          <CardHeader>
            <CardTitle className="text-center">
              No Radio Stations Available
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-muted">
              <Volume2 className="size-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm">
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
    <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col px-4 py-4">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {radios.map((radio: Radio) => (
          <div
            className="group hover:-translate-y-1 relative transition-all duration-300 hover:shadow-lg"
            key={radio.id}
          >
            <RadioComponent
              onDelete={handleDeleteRadio}
              onEdit={handleEditRadio}
              onToggle={handleToggleRadio}
              radio={radio}
            />
          </div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="fade-in zoom-in w-full max-w-md animate-in rounded-lg border bg-background p-6 shadow-xl duration-200">
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
    </div>
  );
}
