// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import { Label } from "@avoid.quest/ui/components/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@avoid.quest/ui/components/radio-group";
import { type ReactNode, useState } from "react";
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

export function ImportExport({
  activePanel,
  resetContent,
}: {
  activePanel: "export" | "import" | "reset";
  resetContent: ReactNode;
}) {
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null
  );
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportKind, setExportKind] = useState<"file" | "link" | null>(null);
  const [shareUrl, setShareUrl] = useState<string>("");
  const [fileInputKey, setFileInputKey] = useState(0);

  const lastExportDate = getLastExportDate();

  const handleExportFile = async () => {
    setIsExporting(true);
    setExportKind("file");
    try {
      await exportDatabase();
    } finally {
      setIsExporting(false);
      setExportKind(null);
    }
  };

  const handleGenerateShareUrl = async () => {
    setIsExporting(true);
    setExportKind("link");
    try {
      await copyShareUrlToClipboard();
      // Generate the URL for display
      const url = await generateShareUrl();
      setShareUrl(url);
    } catch {
      toast.error("Failed to generate share URL");
    } finally {
      setIsExporting(false);
      setExportKind(null);
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

      setFileInputKey((key) => key + 1);
    } catch {
      // The import library already reports the failure.
    } finally {
      setIsImporting(false);
    }
  };

  const handleCancelImport = () => {
    setImportPreview(null);
    (
      window as Window & { pendingImportData?: DatabaseExport }
    ).pendingImportData = undefined;

    setFileInputKey((key) => key + 1);
  };
  const handleImportModeChange = (value: string) => {
    setImportMode(value as ImportMode);
  };

  return (
    <div className="w-full">
      {activePanel === "export" && (
        <div className="space-y-4 py-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              className="w-full"
              disabled={isExporting}
              onClick={handleExportFile}
              size="sm"
              variant="outline"
            >
              {exportKind === "file" ? "Exporting…" : "Download backup"}
            </Button>
            <Button
              className="w-full"
              disabled={isExporting}
              onClick={handleGenerateShareUrl}
              size="sm"
            >
              {exportKind === "link" ? "Generating…" : "Create share link"}
            </Button>
          </div>

          {lastExportDate?.valueOf() && (
            <p className="font-mono text-[10px] text-muted-foreground/60 tabular-nums">
              Last exported: {new Date(lastExportDate).toLocaleString()}
            </p>
          )}

          {shareUrl?.trim() !== "" && (
            <div className="space-y-1.5">
              <Label
                className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider"
                htmlFor="share-url"
              >
                Share URL
              </Label>
              <Input
                className="font-mono text-xs"
                id="share-url"
                readOnly
                value={shareUrl}
              />
              <p className="text-[10px] text-muted-foreground/60">
                Share this URL with others to import your configuration
              </p>
            </div>
          )}
        </div>
      )}

      {activePanel === "import" && (
        <div className="space-y-3">
          <div className="grid gap-4 py-3 sm:grid-cols-2">
            <div className="space-y-3 border-b pb-4 sm:border-r sm:border-b-0 sm:pr-4 sm:pb-0">
              <h3 className="font-mono text-foreground/80 text-xs uppercase tracking-wider">
                From URL
              </h3>
              <div className="space-y-2">
                <Label
                  className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider"
                  htmlFor="import-url"
                >
                  Share URL
                </Label>
                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleUrlImport();
                  }}
                >
                  <Input
                    disabled={isImporting}
                    id="import-url"
                    placeholder="https://radio.avoid.quest/import#data=…"
                    type="url"
                  />
                  <Button
                    className="w-full"
                    disabled={isImporting}
                    size="sm"
                    type="submit"
                  >
                    {isImporting ? "Importing…" : "Import from URL"}
                  </Button>
                </form>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-mono text-foreground/80 text-xs uppercase tracking-wider">
                From File
              </h3>
              <div className="space-y-2">
                <Label
                  className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider"
                  htmlFor="import-file"
                >
                  JSON File
                </Label>
                <Input
                  accept=".json"
                  disabled={isImporting}
                  id="import-file"
                  key={fileInputKey}
                  onChange={handleFileImport}
                  type="file"
                />
              </div>
            </div>
          </div>

          {importPreview?.valueOf() && (
            <div className="border-t pt-3">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  <h4 className="font-mono text-foreground/80 text-xs uppercase tracking-wider">
                    Import Preview
                  </h4>
                </div>

                <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
                  <div>
                    <span className="text-muted-foreground">New:</span>
                    <span className="ml-1.5 text-emerald-500">
                      {importPreview.newRadios}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Updated:</span>
                    <span className="ml-1.5 text-primary">
                      {importPreview.updatedRadios}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Unchanged:</span>
                    <span className="ml-1.5 text-foreground/60">
                      {importPreview.unchangedRadios}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Settings:</span>
                    <span className="ml-1.5">
                      {importPreview.settingsChanged ? "Changed" : "No change"}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                    Import Mode
                  </Label>
                  <RadioGroup
                    onValueChange={handleImportModeChange}
                    value={importMode}
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem id="merge" value="merge" />
                      <Label className="text-xs" htmlFor="merge">
                        Merge: update matches, add new ones hidden
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem id="replace" value="replace" />
                      <Label className="text-xs" htmlFor="replace">
                        Replace — overwrite the station list
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={isImporting}
                    onClick={handleApplyImport}
                    size="sm"
                  >
                    {isImporting ? "Importing…" : "Apply import"}
                  </Button>
                  <Button
                    disabled={isImporting}
                    onClick={handleCancelImport}
                    size="sm"
                    variant="outline"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activePanel === "reset" && resetContent}
    </div>
  );
}
