/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import { Card } from "@avoid.quest/ui/components/card";
import { Label } from "@avoid.quest/ui/components/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@avoid.quest/ui/components/radio-group";
import { Separator } from "@avoid.quest/ui/components/separator";
import { Spinner } from "@avoid.quest/ui/components/spinner";
import { useNavigate } from "@tanstack/react-router";
import { HomeIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  autoImportFromUrl,
  hasImportDataInUrl,
  mergeImportedData,
  previewImportChanges,
  replaceImportedData,
} from "@/lib/db/export-import";
import type { DatabaseExport, ImportMode, ImportPreview } from "@/lib/types";

export function ImportPage() {
  const navigate = useNavigate();
  const [importData, setImportData] = useState<DatabaseExport | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null
  );
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    const handleImport = async () => {
      if (!hasImportDataInUrl()) {
        setIsLoading(false);
        return;
      }

      try {
        const data = autoImportFromUrl();
        if (data) {
          setImportData(data);
          const preview = await previewImportChanges(data);
          setImportPreview(preview);
        } else {
          // No import data found, redirect to home
          navigate({ to: "/" });
        }
      } catch {
        toast.error("Couldn't read share link");
        navigate({ to: "/" });
      } finally {
        setIsLoading(false);
      }
    };

    handleImport();
  }, [navigate]);

  const handleApplyImport = async () => {
    if (!importData) {
      return;
    }

    setIsImporting(true);
    try {
      if (importMode === "replace") {
        await replaceImportedData(importData);
      } else {
        await mergeImportedData(importData);
      }

      navigate({ to: "/" });
    } catch {
      // The import library already reports the failure.
    } finally {
      setIsImporting(false);
    }
  };

  const handleCancel = () => {
    navigate({ to: "/" });
  };
  const handleImportModeChange = (value: string) => {
    setImportMode(value as ImportMode);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="space-y-4 text-center">
          <Spinner className="mx-auto" />
          <p className="text-muted-foreground">Loading configuration…</p>
        </div>
      </div>
    );
  }

  if (!(importData && importPreview)) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <h1 className="mb-2 font-semibold text-lg">Nothing to import</h1>
          <p className="mb-6 text-muted-foreground text-sm">
            This link doesn't contain stations to import.
          </p>
          <Button onClick={handleCancel} size="sm">
            <HomeIcon className="size-3.5" />
            Go home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4">
      <div className="space-y-2 text-center">
        <h1 className="font-semibold text-lg">Import configuration</h1>
        <p className="text-muted-foreground">
          Someone shared their radio configuration with you. Review the changes
          below and choose how to import them.
        </p>
      </div>

      <Card className="p-6">
        <div className="space-y-4">
          <h3 className="font-medium">Preview</h3>

          <div className="grid grid-cols-2 gap-4 text-sm tabular-nums">
            <div>
              <span className="text-muted-foreground">New:</span>
              <span className="ml-2 font-medium">
                {importPreview.newRadios}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Updated:</span>
              <span className="ml-2 font-medium">
                {importPreview.updatedRadios}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Unchanged:</span>
              <span className="ml-2 font-medium">
                {importPreview.unchangedRadios}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Settings:</span>
              <span className="ml-2 font-medium">
                {importPreview.settingsChanged ? "Changed" : "No change"}
              </span>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="space-y-4">
          <div>
            <h3 className="mb-2 font-medium">Mode</h3>
            <p className="mb-4 text-muted-foreground text-sm">
              Choose how you want to import this configuration:
            </p>
          </div>

          <RadioGroup onValueChange={handleImportModeChange} value={importMode}>
            <div className="space-y-3">
              <div className="flex items-start space-x-3 rounded-lg border p-3">
                <RadioGroupItem className="mt-1" id="merge" value="merge" />
                <div className="space-y-1">
                  <Label className="font-medium" htmlFor="merge">
                    Merge
                  </Label>
                  <p className="text-muted-foreground text-sm">
                    Update matching stations, add new ones hidden.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3 rounded-lg border p-3">
                <RadioGroupItem className="mt-1" id="replace" value="replace" />
                <div className="space-y-1">
                  <Label className="font-medium" htmlFor="replace">
                    Replace
                  </Label>
                  <p className="text-muted-foreground text-sm">
                    Overwrite the station list.
                  </p>
                </div>
              </div>
            </div>
          </RadioGroup>

          <Separator />

          <div className="flex gap-3">
            <Button
              className="flex-1"
              disabled={isImporting}
              onClick={handleApplyImport}
            >
              {isImporting ? "Importing…" : "Apply import"}
            </Button>
            <Button
              disabled={isImporting}
              onClick={handleCancel}
              variant="outline"
            >
              Cancel
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
