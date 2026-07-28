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
import { Slider } from "@avoid.quest/ui/components/slider";
import { Switch } from "@avoid.quest/ui/components/switch";
import {
  DatabaseIcon,
  ListMusicIcon,
  type LucideIcon,
  RadioIcon,
  RotateCcwIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";
import {
  type SettingsRecord,
  setRestoreStateOnLoad,
  setSingleModeTransitionDuration,
} from "@/lib/collections";
import { DEFAULT_TRANSITION_DURATION } from "@/lib/const";
import { useSettings } from "@/lib/hooks/use-settings";
import { resetAllSettings } from "@/lib/settings";
import { RadioManagement } from "./radio-management";
import { SettingsSelect } from "./settings-select";

const ImportExport = lazy(() =>
  import("./import-export").then((mod) => ({ default: mod.ImportExport }))
);
const AudioSettings = lazy(() =>
  import("./audio-settings").then((mod) => ({ default: mod.AudioSettings }))
);
const MidiSettings = lazy(() =>
  import("./midi-settings").then((mod) => ({ default: mod.MidiSettings }))
);

const MAX_TRANSITION_DURATION = 10_000;

type SettingsSection = "radios" | "playback" | "midi" | "data";

type PlaybackPanel = "player" | "audio";
type DataPanel = "export" | "import" | "reset";

const DATA_PANEL_GUIDANCE: Record<DataPanel, string> = {
  export:
    "Stations and playback settings stay in this browser. Download a backup or create a link containing the same data—nothing is uploaded.",
  import:
    "Nothing changes until Apply. Both modes import playback settings; Merge keeps station order and enabled states.",
  reset:
    "Restores default stations and playback settings and clears saved sessions. MIDI mappings are kept.",
};

type SectionDefinition = {
  key: SettingsSection;
  label: string;
  icon: LucideIcon;
};

const SETTINGS_SECTIONS: SectionDefinition[] = [
  { key: "radios", label: "Radios", icon: RadioIcon },
  { key: "playback", label: "Playback", icon: Settings2Icon },
  { key: "midi", label: "MIDI", icon: SlidersHorizontalIcon },
  { key: "data", label: "Data", icon: DatabaseIcon },
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
  if (defaultTab === "playback" || defaultTab === "data") {
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
  const [playbackPanel, setPlaybackPanel] = useState<PlaybackPanel>(
    defaultTab === "player" ? "player" : "audio"
  );
  const [dataPanel, setDataPanel] = useState<DataPanel>(() =>
    getInitialDataPanel(defaultTab)
  );
  const [transitionDuration, setTransitionDuration] = useState(
    settings?.player.single?.transitionDuration ?? DEFAULT_TRANSITION_DURATION
  );
  const [isResetting, setIsResetting] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);

  const handleTransitionDurationChange = (value: number[]) => {
    const nextDuration = value[0] ?? 0;
    const previousDuration = transitionDuration;
    setTransitionDuration(nextDuration);
    try {
      setSingleModeTransitionDuration(nextDuration);
    } catch {
      setTransitionDuration(previousDuration);
      toast.error("Failed to update transition duration. Changes reverted.");
    }
  };

  const handleReset = async () => {
    setIsResetting(true);
    try {
      await resetAllSettings();
      setShowResetDialog(false);
      toast.success("All settings reset to defaults");
    } catch {
      toast.error("Failed to reset all settings");
    } finally {
      setIsResetting(false);
    }
  };

  if (!settings) {
    return <LoadingFallback />;
  }

  return (
    <div className="flex h-[72vh] min-h-0 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
        <nav className="grid shrink-0 grid-cols-4 gap-1 md:flex md:w-40 md:flex-col">
          {SETTINGS_SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <Button
                className="min-w-0 justify-center gap-1 px-1 has-[>svg]:px-1 md:justify-start md:gap-2 md:px-3 md:has-[>svg]:px-3"
                key={section.key}
                onClick={() => setActive(section.key)}
                size="sm"
                variant={active === section.key ? "secondary" : "ghost"}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{section.label}</span>
              </Button>
            );
          })}
          <span className="mt-auto hidden px-2 py-1 font-mono text-[10px] text-muted-foreground/40 md:block">
            v{__APP_VERSION__}
          </span>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto border-t pt-3 md:border-t-0 md:border-l md:pt-0 md:pl-4">
          <SectionContent
            dataPanel={dataPanel}
            isResetting={isResetting}
            onDataPanelChange={setDataPanel}
            onPlaybackPanelChange={setPlaybackPanel}
            onReset={handleReset}
            onResetDialogChange={setShowResetDialog}
            onTransitionDurationChange={handleTransitionDurationChange}
            playbackPanel={playbackPanel}
            section={active}
            settings={settings}
            showResetDialog={showResetDialog}
            transitionDuration={transitionDuration}
          />
        </div>
      </div>

      <div className="flex items-center gap-3 md:hidden">
        <span className="font-mono text-[10px] text-muted-foreground/40">
          v{__APP_VERSION__}
        </span>
        <DrawerClose asChild>
          <Button className="flex-1" size="sm" variant="outline">
            Close
          </Button>
        </DrawerClose>
      </div>
    </div>
  );
}

type SectionContentProps = {
  section: SettingsSection;
  playbackPanel: PlaybackPanel;
  dataPanel: DataPanel;
  settings: SettingsRecord;
  transitionDuration: number;
  onTransitionDurationChange: (value: number[]) => void;
  isResetting: boolean;
  showResetDialog: boolean;
  onResetDialogChange: (open: boolean) => void;
  onReset: () => Promise<void>;
  onPlaybackPanelChange: (panel: PlaybackPanel) => void;
  onDataPanelChange: (panel: DataPanel) => void;
};

function SectionContent({
  section,
  playbackPanel,
  dataPanel,
  onPlaybackPanelChange,
  onDataPanelChange,
  ...props
}: SectionContentProps) {
  if (section === "radios") {
    return <RadioManagement />;
  }
  if (section === "playback") {
    return (
      <div className="space-y-3">
        <SectionNav
          onValueChange={(value) =>
            onPlaybackPanelChange(value as PlaybackPanel)
          }
          options={[
            { label: "Audio", value: "audio" },
            { label: "Player", value: "player" },
          ]}
          value={playbackPanel}
        />
        {playbackPanel === "player" ? (
          <PlayerSettings {...props} />
        ) : (
          <Suspense fallback={<LoadingFallback />}>
            <AudioSettings />
          </Suspense>
        )}
      </div>
    );
  }
  if (section === "midi") {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <MidiSettings />
      </Suspense>
    );
  }
  return (
    <div className="space-y-3">
      <SectionNav
        onValueChange={(value) => onDataPanelChange(value as DataPanel)}
        options={[
          { label: "Export", value: "export" },
          { label: "Import", value: "import" },
          { label: "Reset", value: "reset", destructive: true },
        ]}
        value={dataPanel}
      />
      <p className="text-muted-foreground text-xs">
        {DATA_PANEL_GUIDANCE[dataPanel]}
      </p>
      <Suspense fallback={<LoadingFallback />}>
        <ImportExport
          activePanel={dataPanel}
          resetContent={<ResetSettings {...props} />}
        />
      </Suspense>
    </div>
  );
}

function SectionNav({
  options,
  value,
  onValueChange,
}: {
  options: { label: string; value: string; destructive?: boolean }[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="flex gap-1 border-b pb-3">
      {options.map((option) => (
        <Button
          className={option.destructive ? "text-destructive" : undefined}
          key={option.value}
          onClick={() => onValueChange(option.value)}
          size="sm"
          variant={option.value === value ? "secondary" : "ghost"}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function PlayerSettings({
  settings,
  transitionDuration,
  onTransitionDurationChange,
}: Pick<
  SectionContentProps,
  "settings" | "transitionDuration" | "onTransitionDurationChange"
>) {
  const handleRestoreStateToggle = (checked: boolean) => {
    try {
      setRestoreStateOnLoad(checked);
    } catch {
      toast.error("Failed to update setting");
    }
  };

  return (
    <div className="divide-y">
      <SettingRow control={<SettingsSelect />} title="Player mode" />
      <SettingRow
        control={
          <Switch
            checked={settings.player.restoreStateOnLoad !== false}
            id="restore-state"
            onCheckedChange={handleRestoreStateToggle}
          />
        }
        title="Restore playback state"
      />
      {settings.player.mode === "single" && (
        <SettingRow
          control={
            <div className="flex min-w-56 items-center gap-4">
              <Slider
                className="flex-1"
                max={MAX_TRANSITION_DURATION}
                onValueChange={onTransitionDurationChange}
                step={100}
                value={[transitionDuration]}
              />
              <span className="w-8 font-mono text-[10px] tabular-nums">
                {(transitionDuration / 1000).toFixed(1)}s
              </span>
            </div>
          }
          icon={ListMusicIcon}
          title="Crossfade duration"
        />
      )}
    </div>
  );
}

function SettingRow({
  title,
  control,
  icon: Icon,
}: {
  title: string;
  control: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center">
      <span className="flex items-center gap-2 text-sm">
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
        {title}
      </span>
      {control}
    </div>
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
  return (
    <div className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center">
      <span className="text-sm">Restore stations and playback settings</span>
      <Dialog onOpenChange={onResetDialogChange} open={showResetDialog}>
        <DialogTrigger asChild>
          <Button size="sm" variant="destructive">
            <RotateCcwIcon /> Reset
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset stations and playback?</DialogTitle>
            <DialogDescription>
              Stations, playback settings, and saved sessions will return to
              their defaults. MIDI mappings are kept. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={isResetting}
              onClick={() => onResetDialogChange(false)}
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

function LoadingFallback() {
  return (
    <p className="py-8 text-center font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
      Loading…
    </p>
  );
}
