import { ModeSelect } from "./mode-select";

export function SettingsSelect() {
  return (
    <div className="space-y-2">
      <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
        Player Mode
      </span>
      <ModeSelect className="max-w-full" />
    </div>
  );
}
