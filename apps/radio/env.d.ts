declare const __APP_VERSION__: string;
/** The newest What's new entry's date, or null; see `git-changelog.ts`. */
declare const __CHANGELOG_NEWEST_DATE__: string | null;

declare module "virtual:changelog" {
  const entries: import("@avoid.quest/ui/lib/changelog").ChangelogEntry[];
  export default entries;
}
