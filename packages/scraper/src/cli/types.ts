// CLI Types and Interfaces

export interface ScrapeOptions {
  postsPerProfile?: number;
  continueOnError?: boolean;
  useSmartSelection?: boolean;
  maxUsers?: number;
  verbose?: boolean;
  help?: boolean;
}

export interface TelegramOptions {
  limit?: number;
  sendOnly?: boolean;
  verbose?: boolean;
  help?: boolean;
}

export interface CronOptions {
  start?: boolean;
  status?: boolean;
  trigger?: string;
  stop?: string;
  startJob?: string;
  verbose?: boolean;
  help?: boolean;
}

export interface StartBothOptions {
  postsPerProfile?: number;
  continueOnError?: boolean;
  useSmartSelection?: boolean;
  maxUsers?: number;
  limit?: number;
  sendOnly?: boolean;
  verbose?: boolean;
  help?: boolean;
}

export interface AdminOptions {
  verbose?: boolean;
  help?: boolean;
}

export interface SinglePostOptions {
  url?: string;
  save?: boolean;
  verbose?: boolean;
  help?: boolean;
}

export interface StartOptions {
  verbose?: boolean;
  help?: boolean;
}

export interface GlobalOptions {
  verbose?: boolean;
  help?: boolean;
  version?: boolean;
}

export interface ParsedArgs {
  command: string;
  subcommand?: string;
  options:
    | ScrapeOptions
    | TelegramOptions
    | CronOptions
    | StartBothOptions
    | AdminOptions
    | SinglePostOptions
    | StartOptions
    | GlobalOptions;
  positionals: string[];
}

export type Command =
  | "start"
  | "scrape"
  | "telegram"
  | "cron"
  | "start-both"
  | "admin"
  | "user"
  | "single-post"
  | "settings"
  | "help"
  | "version";

export type CronSubcommand =
  | "start"
  | "status"
  | "trigger"
  | "stop"
  | "start-job";

