import entries from "virtual:changelog";
import { Changelog } from "@avoid.quest/ui/components/changelog";
import { Skeleton } from "@avoid.quest/ui/components/skeleton";
import { CHANGELOG_STORAGE_KEY } from "@/lib/const";
import { useSettings } from "@/lib/hooks/use-settings";

/** Changes come from merged `feat` commits; see `git-changelog.ts`. */
export function WhatsNew() {
  const { data: settings } = useSettings();

  // A first visit is marked seen while its settings are created, so waiting
  // for them keeps the dot from flashing for someone who is new.
  if (!settings) {
    return <Skeleton className="size-7" />;
  }

  return (
    <Changelog
      entries={entries}
      footer={`v${__APP_VERSION__}`}
      storageKey={CHANGELOG_STORAGE_KEY}
    />
  );
}
