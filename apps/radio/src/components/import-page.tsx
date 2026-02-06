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
        toast.error("Failed to import configuration from URL");
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

      toast.success("Configuration imported successfully!");
      navigate({ to: "/" });
    } catch {
      toast.error("Failed to import configuration");
    } finally {
      setIsImporting(false);
    }
  };

  const handleCancel = () => {
    navigate({ to: "/" });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="space-y-4 text-center">
          <Spinner className="mx-auto" />
          <p className="text-muted-foreground">Loading configuration...</p>
        </div>
      </div>
    );
  }

  if (!(importData && importPreview)) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="space-y-4 text-center">
          <h2 className="font-semibold text-xl">No Configuration Found</h2>
          <p className="text-muted-foreground">
            This URL doesn't contain a valid configuration to import.
          </p>
          <Button onClick={handleCancel} variant="outline">
            Go to Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4">
      <div className="space-y-2 text-center">
        <h1 className="font-bold text-2xl">Import Configuration</h1>
        <p className="text-muted-foreground">
          Someone shared their radio configuration with you. Review the changes
          below and choose how to import them.
        </p>
      </div>

      <Card className="border-blue-200 bg-blue-50/50 p-6">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-blue-500" />
            <h3 className="font-medium">Import Preview</h3>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">New radios:</span>
              <span className="ml-2 font-medium text-green-600">
                {importPreview.newRadios}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Updated radios:</span>
              <span className="ml-2 font-medium text-blue-600">
                {importPreview.updatedRadios}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Unchanged radios:</span>
              <span className="ml-2 font-medium text-gray-600">
                {importPreview.unchangedRadios}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Settings changed:</span>
              <span className="ml-2 font-medium">
                {importPreview.settingsChanged ? "Yes" : "No"}
              </span>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="space-y-4">
          <div>
            <h3 className="mb-2 font-medium">Import Mode</h3>
            <p className="mb-4 text-muted-foreground text-sm">
              Choose how you want to import this configuration:
            </p>
          </div>

          <RadioGroup
            onValueChange={(value) => setImportMode(value as ImportMode)}
            value={importMode}
          >
            <div className="space-y-3">
              <div className="flex items-start space-x-3 rounded-lg border p-3">
                <RadioGroupItem className="mt-1" id="merge" value="merge" />
                <div className="space-y-1">
                  <Label className="font-medium" htmlFor="merge">
                    Merge (Recommended)
                  </Label>
                  <p className="text-muted-foreground text-sm">
                    Keep your existing radios and settings, add new ones, and
                    update changed ones. Your custom order and preferences will
                    be preserved.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3 rounded-lg border p-3">
                <RadioGroupItem className="mt-1" id="replace" value="replace" />
                <div className="space-y-1">
                  <Label className="font-medium" htmlFor="replace">
                    Replace All
                  </Label>
                  <p className="text-muted-foreground text-sm">
                    Clear all your existing radios and settings, then import the
                    new configuration. This will remove all your current data.
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
              {isImporting ? "Importing..." : "Import Configuration"}
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
