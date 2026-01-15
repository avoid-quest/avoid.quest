import type { PlatformMetadata } from "@avoid.quest/radio-shared";

export type Radio = {
  id?: number;
  name: string;
  streamUrl: string;
  logoUrl?: string;
  description?: string;
  websiteUrl?: string;
  order?: number;
  enabled?: boolean;
  platformMetadata?: PlatformMetadata;
};

export type ScrapedOption = {
  value: string;
  label: string;
  confidence: number;
  preview?: string;
};

export type RadioMetadata = {
  name?: ScrapedOption[];
  streamUrl?: ScrapedOption[];
  logoUrl?: ScrapedOption[];
  description?: ScrapedOption[];
  websiteUrl?: string;
  foundFields: string[];
  missingFields: string[];
};
