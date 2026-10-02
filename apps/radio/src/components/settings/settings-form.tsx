// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Button } from "@avoid.quest/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@avoid.quest/ui/components/dialog";
import { DrawerClose } from "@avoid.quest/ui/components/drawer";
import {
  Field,
  FieldLabel,
  FieldTitle,
} from "@avoid.quest/ui/components/field";
import { Switch } from "@avoid.quest/ui/components/switch";
import { Tabs, TabsList, TabsTrigger } from "@avoid.quest/ui/components/tabs";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@avoid.quest/ui/components/toggle-group";
import { useIsMobile } from "@avoid.quest/ui/hooks/use-mobile";
import {
  DatabaseIcon,
  type LucideIcon,
  MonitorIcon,
  MoonIcon,
  RadioIcon,
  RotateCcwIcon,
  Settings2Icon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SunIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";
import { type SettingsRecord, setRestoreStateOnLoad } from "@/lib/collections";
import { useSettings } from "@/lib/hooks/use-settings";
import { resetAllSettings } from "@/lib/settings";
import { LoadingFallback, RadioManagement } from "./radio-management";

const ImportExport = lazy(() =>
  import("./import-export").then((mod) => ({ default: mod.ImportExport }))
);
const AudioSettings = lazy(() =>
  import("./audio-settings").then((mod) => ({ default: mod.AudioSettings }))
);
const MidiSettings = lazy(() =>
  import("./midi-settings").then((mod) => ({ default: mod.MidiSettings }))
);

type SettingsSection = "general" | "radios" | "playback" | "midi" | "data";

type DataPanel = "export" | "import" | "reset";

const DATA_PANELS: { label: string; value: DataPanel }[] = [
  { label: "Export", value: "export" },
  { label: "Import", value: "import" },
  { label: "Reset", value: "reset" },
];

const THEMES: { icon: LucideIcon; label: string; value: string }[] = [
  { icon: SunIcon, label: "Light", value: "light" },
  { icon: MoonIcon, label: "Dark", value: "dark" },
  { icon: MonitorIcon, label: "System", value: "system" },
];

const DATA_PANEL_GUIDANCE: Record<DataPanel, string> = {
  export:
    "Stations and playback settings stay in this browser. Download a backup or create a link containing the same data—nothing is uploaded.",
  import:
    "Nothing changes until Apply. Both modes import playback settings; Merge keeps station order and enabled states.",
  reset: "",
};

type SectionDefinition = {
  key: SettingsSection;
  label: string;
  icon: LucideIcon;
};

const SETTINGS_SECTIONS: SectionDefinition[] = [
  { icon: SettingsIcon, key: "general", label: "General" },
  { icon: RadioIcon, key: "radios", label: "Radios" },
  { icon: Settings2Icon, key: "playback", label: "Playback" },
  { icon: SlidersHorizontalIcon, key: "midi", label: "MIDI" },
  { icon: DatabaseIcon, key: "data", label: "Data" },
];

function getInitialSection(defaultTab?: string): SettingsSection {
  if (defaultTab === "player" || defaultTab === "audio") {
    return "playback";
  }
  if (
    defaultTab === "import-export" ||
    defaultTab === "export" ||
    defaultTab === "import" ||
    defaultTab === "reset"
  ) {
    return "data";
  }
  if (
    defaultTab === "general" ||
    defaultTab === "playback" ||
    defaultTab === "data"
  ) {
    return defaultTab;
  }
  return defaultTab === "midi" ? "midi" : "radios";
}

function getInitialDataPanel(defaultTab?: string): DataPanel {
  if (defaultTab === "reset") {
    return "reset";
  }
  return defaultTab === "import" ? "import" : "export";
}

export function SettingsForm({
  settings: passedSettings,
  defaultTab,
}: {
  settings?: SettingsRecord;
  defaultTab?: string;
}) {
  const { data: liveSettings } = useSettings();
  const settings = liveSettings || passedSettings;
  const [active, setActive] = useState<SettingsSection>(() =>
    getInitialSection(defaultTab)
  );
  const [dataPanel, setDataPanel] = useState<DataPanel>(() =>
    getInitialDataPanel(defaultTab)
  );
  const [isResetting, setIsResetting] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);

  const handleReset = async () => {
    setIsResetting(true);
    try {
      await resetAllSettings();
      setShowResetDialog(false);
      toast.success("Stations and playback reset");
    } catch {
      toast.error("Couldn't reset");
    } finally {
      setIsResetting(false);
    }
  };
  // The section list is a column from md up: arrow keys follow its layout.
  const isMobile = useIsMobile();
  const handleSectionChange = (value: string) => {
    setActive(value as SettingsSection);
  };

  if (!settings) {
    return <LoadingFallback />;
  }

  return (
    <div className="flex h-[72vh] min-h-0 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
        <div className="flex shrink-0 flex-col md:w-40">
          <Tabs
            onValueChange={handleSectionChange}
            orientation={isMobile ? "horizontal" : "vertical"}
            value={active}
          >
            <TabsList className="grid h-auto w-full grid-cols-5 md:flex md:flex-col md:items-stretch md:bg-transparent md:p-0">
              {SETTINGS_SECTIONS.map((section) => {
                const Icon = section.icon;
                return (
                  <TabsTrigger
                    className="min-w-0 gap-1.5 px-1 text-xs md:justify-start md:px-3 md:py-1.5 md:data-[state=active]:bg-muted md:data-[state=active]:shadow-none"
                    key={section.key}
                    value={section.key}
                  >
                    <Icon className="hidden size-3.5 shrink-0 md:block" />
                    <span className="truncate">{section.label}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t pt-3 md:border-t-0 md:border-l md:pt-0 md:pl-4">
          <SectionContent
            dataPanel={dataPanel}
            isResetting={isResetting}
            onDataPanelChange={setDataPanel}
            onReset={handleReset}
            onResetDialogChange={setShowResetDialog}
            section={active}
            settings={settings}
            showResetDialog={showResetDialog}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <DrawerClose asChild>
          <Button
            className="flex-1 md:ml-auto md:flex-none"
            size="sm"
            variant="outline"
          >
            Close
          </Button>
        </DrawerClose>
      </div>
    </div>
  );
}

type SectionContentProps = {
  section: SettingsSection;
  dataPanel: DataPanel;
  settings: SettingsRecord;
  isResetting: boolean;
  showResetDialog: boolean;
  onResetDialogChange: (open: boolean) => void;
  onReset: () => Promise<void>;
  onDataPanelChange: (panel: DataPanel) => void;
};

function SectionContent({
  section,
  dataPanel,
  onDataPanelChange,
  ...props
}: SectionContentProps) {
  if (section === "general") {
    return <GeneralSettings settings={props.settings} />;
  }
  if (section === "radios") {
    return <RadioManagement />;
  }
  if (section === "playback") {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <AudioSettings />
      </Suspense>
    );
  }
  if (section === "midi") {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <MidiSettings />
      </Suspense>
    );
  }
  const handleDataPanelChange = (value: string) => {
    onDataPanelChange(value as DataPanel);
  };

  return (
    <div className="space-y-3">
      <Tabs onValueChange={handleDataPanelChange} value={dataPanel}>
        <TabsList className="h-8">
          {DATA_PANELS.map((panel) => (
            <TabsTrigger
              className="px-3 text-xs"
              key={panel.value}
              value={panel.value}
            >
              {panel.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {DATA_PANEL_GUIDANCE[dataPanel] ? (
        <p className="text-muted-foreground text-xs">
          {DATA_PANEL_GUIDANCE[dataPanel]}
        </p>
      ) : null}
      <Suspense fallback={<LoadingFallback />}>
        <ImportExport
          activePanel={dataPanel}
          resetContent={<ResetSettings {...props} />}
        />
      </Suspense>
    </div>
  );
}

function GeneralSettings({ settings }: Pick<SectionContentProps, "settings">) {
  const { theme, setTheme } = useTheme();
  const handleThemeChange = (value: string) => {
    // Pressing the selected item again would otherwise clear the choice.
    if (value) {
      setTheme(value);
    }
  };
  const handleRestoreStateToggle = (checked: boolean) => {
    try {
      setRestoreStateOnLoad(checked);
    } catch {
      toast.error("Couldn't save setting");
    }
  };

  return (
    <div className="divide-y">
      <SettingRow
        control={
          <ToggleGroup
            aria-label="Theme"
            onValueChange={handleThemeChange}
            type="single"
            value={theme ?? "system"}
            variant="outline"
          >
            {THEMES.map(({ icon: Icon, label, value }) => (
              <ToggleGroupItem
                className="h-7 cursor-pointer gap-1.5 px-2.5 text-xs"
                key={value}
                value={value}
              >
                <Icon className="size-3.5" />
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
        title="Theme"
      />
      <SettingRow
        control={
          <Switch
            checked={settings.player.restoreStateOnLoad !== false}
            id="restore-state"
            onCheckedChange={handleRestoreStateToggle}
          />
        }
        controlId="restore-state"
        title="Restore playback state"
      />
      <SettingRow
        control={
          <span className="font-mono text-muted-foreground text-xs">
            v{__APP_VERSION__}
          </span>
        }
        title="Version"
      />
    </div>
  );
}

function SettingRow({
  title,
  control,
  controlId,
  icon: Icon,
}: {
  title: string;
  control: React.ReactNode;
  /** The control's id, so the title is its accessible name. Without one the
   * control must name itself. */
  controlId?: string;
  icon?: LucideIcon;
}) {
  const content = (
    <>
      {Icon ? <Icon className="size-3.5 text-muted-foreground" /> : null}
      {title}
    </>
  );
  return (
    <Field className="py-3" orientation="horizontal">
      {controlId ? (
        <FieldLabel className="items-center font-medium" htmlFor={controlId}>
          {content}
        </FieldLabel>
      ) : (
        <FieldTitle>{content}</FieldTitle>
      )}
      {control}
    </Field>
  );
}

function ResetSettings({
  isResetting,
  showResetDialog,
  onResetDialogChange,
  onReset,
}: Pick<
  SectionContentProps,
  "isResetting" | "showResetDialog" | "onResetDialogChange" | "onReset"
>) {
  const handleCancel = () => {
    onResetDialogChange(false);
  };

  return (
    <div className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center">
      <span className="text-sm">
        Reset stations and playback settings to defaults
      </span>
      <Dialog onOpenChange={onResetDialogChange} open={showResetDialog}>
        <DialogTrigger asChild>
          <Button size="sm" variant="destructive">
            <RotateCcwIcon /> Reset
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset stations and playback?</DialogTitle>
            <DialogDescription>
              Stations, playback settings, and saved sessions will return to
              their defaults. MIDI mappings are kept. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={isResetting}
              onClick={handleCancel}
              size="sm"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={isResetting}
              onClick={onReset}
              size="sm"
              variant="destructive"
            >
              {isResetting ? "Resetting…" : "Reset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
