import type {
  BandcampMetadata,
  BandcampSearchFilter,
  BandcampSearchResult,
} from "../bandcamp/index.js";
import type {
  RadioGardenMetadata,
  RadioGardenSearchResult,
} from "../radiogarden/index.js";
import type {
  SoundCloudMetadata,
  SoundCloudSearchResult,
} from "../soundcloud/index.js";
import type { PlatformStreamFormat } from "../stream-format.js";

export const RESOLVER_PROVIDERS = [
  "bandcamp",
  "soundcloud",
  "radiogarden",
] as const;

export type ResolverProvider = (typeof RESOLVER_PROVIDERS)[number];

export type ResolverStreamFormat = PlatformStreamFormat;

export const RESOLVER_CAPABILITIES = [
  "bandcamp:search",
  "bandcamp:resolve",
  "soundcloud:search",
  "soundcloud:resolve",
  "radiogarden:search",
  "radiogarden:resolve",
] as const;

export type ResolverCapability = (typeof RESOLVER_CAPABILITIES)[number];

const RESOLVER_CAPABILITY_SET = new Set<string>(RESOLVER_CAPABILITIES);

export function isResolverCapability(
  value: unknown
): value is ResolverCapability {
  return typeof value === "string" && RESOLVER_CAPABILITY_SET.has(value);
}

export type ResolverManifest = {
  protocol: "avoid-radio-resolver";
  version: 1;
  name: string;
  capabilities: readonly ResolverCapability[];
};

export type ResolverSearchResultMap = {
  bandcamp: BandcampSearchResult[];
  radiogarden: RadioGardenSearchResult[];
  soundcloud: SoundCloudSearchResult[];
};

export type ResolverMetadataMap = {
  bandcamp: BandcampMetadata;
  radiogarden: RadioGardenMetadata;
  soundcloud: SoundCloudMetadata;
};

export type ResolverSearchFilter<P extends ResolverProvider> =
  P extends "bandcamp" ? BandcampSearchFilter : never;

export type ResolverSearchRequest<P extends ResolverProvider> = {
  provider: P;
  query: string;
  filter?: ResolverSearchFilter<P>;
  signal?: AbortSignal;
};

export type ResolverResolveRequest<P extends ResolverProvider> = {
  provider: P;
  url: string;
  signal?: AbortSignal;
};

export type ResolverResolution<P extends ResolverProvider> = {
  format?: ResolverStreamFormat;
  metadata: ResolverMetadataMap[P];
  resolverId: string;
  streamUrl: string;
  expiresAt?: string;
};

export type ResolverAdapter = {
  readonly id: string;
  probe(signal?: AbortSignal): Promise<ResolverManifest>;
  search<P extends ResolverProvider>(
    request: ResolverSearchRequest<P>
  ): Promise<ResolverSearchResultMap[P]>;
  resolve<P extends ResolverProvider>(
    request: ResolverResolveRequest<P>
  ): Promise<ResolverResolution<P>>;
};

export type ResolverBroker = {
  readonly adapters: readonly ResolverAdapter[];
  search<P extends ResolverProvider>(
    request: ResolverSearchRequest<P>
  ): Promise<ResolverSearchResultMap[P]>;
  resolve<P extends ResolverProvider>(
    request: ResolverResolveRequest<P>
  ): Promise<ResolverResolution<P>>;
};
