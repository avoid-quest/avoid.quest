import type { ChangelogEntry } from "@avoid.quest/ui/lib/changelog";

/**
 * Storybook's stand-in for `virtual:changelog`, which the app builds from git
 * history. Storybook's config defines `__CHANGELOG_NEWEST_DATE__` from this.
 */
export const RADIO_CHANGELOG_NEWEST_DATE = "2026-10-20T12:00:00.000Z";

const entries: ChangelogEntry[] = [
  {
    date: RADIO_CHANGELOG_NEWEST_DATE,
    id: "storybook-colours",
    text: "Refresh the player's colours and text",
  },
  {
    date: "2026-10-02T12:00:00.000Z",
    id: "storybook-undo",
    text: "Let you tap Undo while Settings is open on phones",
  },
];

export default entries;
