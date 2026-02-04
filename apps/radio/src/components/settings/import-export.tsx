import { Button } from "@avoid.quest/ui/components/button";
import { Card } from "@avoid.quest/ui/components/card";
import { Input } from "@avoid.quest/ui/components/input";
import { Label } from "@avoid.quest/ui/components/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@avoid.quest/ui/components/radio-group";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@avoid.quest/ui/components/tabs";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  copyShareUrlToClipboard,
  exportDatabase,
  generateShareUrl,
  getLastExportDate,
  importFromFile,
  importFromUrl,
  mergeImportedData,
  previewImportChanges,
  replaceImportedData,
} from "@/lib/db/export-import";
import type { DatabaseExport, ImportMode, ImportPreview } from "@/lib/types";

export function ImportExport() {
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null
  );
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [shareUrl, setShareUrl] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const lastExportDate = getLastExportDate();

  const handleExportFile = async () => {
    setIsExporting(true);
    try {
      await exportDatabase();
    } finally {
      setIsExporting(false);
    }
  };

  const handleGenerateShareUrl = async () => {
    setIsExporting(true);
    try {
      await copyShareUrlToClipboard();
      // Generate the URL for display
      const url = await generateShareUrl();
      setShareUrl(url);
    } catch {
      toast.error("Failed to generate share URL");
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileImport = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsImporting(true);
    try {
      const importData = await importFromFile(file);
      const preview = await previewImportChanges(importData);
      setImportPreview(preview);

      // Store import data for later use
      (
        window as Window & { pendingImportData?: DatabaseExport }
      ).pendingImportData = importData;
    } catch {
      toast.error("Failed to read import file");
    } finally {
      setIsImporting(false);
    }
  };

  const handleUrlImport = async () => {
    const url = (document.getElementById("import-url") as HTMLInputElement)
      ?.value;
    if (!url) {
      toast.error("Please enter a share URL");
      return;
    }

    setIsImporting(true);
    try {
      const importData = importFromUrl(url);
      const preview = await previewImportChanges(importData);
      setImportPreview(preview);

      // Store import data for later use
      (
        window as Window & { pendingImportData?: DatabaseExport }
      ).pendingImportData = importData;
    } catch {
      toast.error("Failed to import from URL");
    } finally {
      setIsImporting(false);
    }
  };

  const handleApplyImport = async () => {
    const importData = (
      window as Window & { pendingImportData?: DatabaseExport }
    ).pendingImportData;
    if (!importData) {
      toast.error("No import data available");
      return;
    }

    setIsImporting(true);
    try {
      if (importMode === "replace") {
        await replaceImportedData(importData);
      } else {
        await mergeImportedData(importData);
      }

      // Clear state
      setImportPreview(null);
      (
        window as Window & { pendingImportData?: DatabaseExport }
      ).pendingImportData = undefined;

      // Clear file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch {
      toast.error("Failed to apply import");
    } finally {
      setIsImporting(false);
    }
  };

  const handleCancelImport = () => {
    setImportPreview(null);
    (
      window as Window & { pendingImportData?: DatabaseExport }
    ).pendingImportData = undefined;

    // Clear file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="w-full space-y-4">
      <Tabs className="w-full" defaultValue="export">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="export">Export</TabsTrigger>
          <TabsTrigger value="import">Import</TabsTrigger>
        </TabsList>

        <TabsContent className="space-y-4" value="export">
          <Card className="p-4 sm:p-6">
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-base sm:text-lg">
                  Export Your Configuration
                </h3>
                <p className="text-muted-foreground text-sm">
                  Download a backup file or create a shareable link to export
                  your radio stations and settings.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  className="w-full"
                  disabled={isExporting}
                  onClick={handleExportFile}
                  variant="outline"
                >
                  {isExporting ? "Exporting..." : "Download Backup"}
                </Button>
                <Button
                  className="w-full"
                  disabled={isExporting}
                  onClick={handleGenerateShareUrl}
                >
                  {isExporting ? "Generating..." : "Create Share Link"}
                </Button>
              </div>

              {lastExportDate?.valueOf() && (
                <div className="text-muted-foreground text-sm">
                  Last exported: {new Date(lastExportDate).toLocaleString()}
                </div>
              )}

              {shareUrl?.trim() !== "" && (
                <div className="space-y-2">
                  <Label htmlFor="share-url">Share URL:</Label>
                  <Input
                    className="font-mono text-sm"
                    id="share-url"
                    readOnly
                    value={shareUrl}
                  />
                  <p className="text-muted-foreground text-xs">
                    Share this URL with others - they can visit it to import
                    your configuration
                  </p>
                </div>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent className="space-y-4" value="import">
          <div className="space-y-4">
            <Card className="p-4 sm:p-6">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-base sm:text-lg">
                    Import from URL
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    Import radio stations and settings from a share URL.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="import-url">Paste share URL here</Label>
                  <Input
                    disabled={isImporting}
                    id="import-url"
                    placeholder="https://app.com/import#data=..."
                    type="url"
                  />
                  <Button
                    className="w-full"
                    disabled={isImporting}
                    onClick={handleUrlImport}
                  >
                    {isImporting ? "Importing..." : "Import from URL"}
                  </Button>
                </div>
              </div>
            </Card>

            <Card className="p-4 sm:p-6">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-base sm:text-lg">
                    Import from File
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    Upload a JSON configuration file to import radio stations
                    and settings.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="import-file">Select JSON file</Label>
                  <Input
                    accept=".json"
                    disabled={isImporting}
                    id="import-file"
                    onChange={handleFileImport}
                    ref={fileInputRef}
                    type="file"
                  />
                </div>
              </div>
            </Card>
          </div>
        </TabsContent>

        {importPreview?.valueOf() && (
          <Card className="border-blue-200 bg-blue-50/50 p-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-blue-500" />
                <h4 className="font-medium">Import Preview</h4>
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
                  <span className="text-muted-foreground">
                    Unchanged radios:
                  </span>
                  <span className="ml-2 font-medium text-gray-600">
                    {importPreview.unchangedRadios}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    Settings changed:
                  </span>
                  <span className="ml-2 font-medium">
                    {importPreview.settingsChanged ? "Yes" : "No"}
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                <Label>Import Mode</Label>
                <RadioGroup
                  onValueChange={(value) => setImportMode(value as ImportMode)}
                  value={importMode}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem id="merge" value="merge" />
                    <Label className="text-sm" htmlFor="merge">
                      Merge - Keep existing data, add new and update changed
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem id="replace" value="replace" />
                    <Label className="text-sm" htmlFor="replace">
                      Replace - Clear all existing data and import new
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={isImporting}
                  onClick={handleApplyImport}
                >
                  {isImporting ? "Importing..." : "Apply Import"}
                </Button>
                <Button
                  disabled={isImporting}
                  onClick={handleCancelImport}
                  variant="outline"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </Card>
        )}
      </Tabs>
    </div>
  );
}
