declare const __APP_VERSION__: string;

declare module "virtual:changelog" {
  const entries: import("@avoid.quest/ui/lib/changelog").ChangelogEntry[];
  export default entries;
}
