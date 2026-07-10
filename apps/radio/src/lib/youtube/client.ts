import {
  createBrowserInvidiousAdapter,
  createPipedAdapter,
  createYouTubeClient,
  type YouTubeClient,
  type YouTubeProviderAdapterOptions,
} from "@avoid.quest/platforms/youtube";
import {
  getYouTubeProviderConfiguration,
  type YouTubeProviderConfiguration,
} from "./provider-configuration";

export class YouTubeProviderRequiredError extends Error {
  constructor() {
    super("Configure an Invidious or Piped provider in Settings → Relays");
    this.name = "YouTubeProviderRequiredError";
  }
}

type YouTubeClientOptions = Pick<
  YouTubeProviderAdapterOptions,
  "fetchImpl" | "timeoutMs" | "verifyMedia"
>;

export function createConfiguredYouTubeClient(
  configuration: YouTubeProviderConfiguration,
  options: YouTubeClientOptions = {}
): YouTubeClient {
  const providers = configuration.services
    .filter((service) => service.enabled)
    .map((service) => {
      const adapterOptions = {
        ...options,
        baseUrl: service.baseUrl,
        id: service.id,
      };
      return service.kind === "invidious"
        ? createBrowserInvidiousAdapter(adapterOptions)
        : createPipedAdapter(adapterOptions);
    });

  if (providers.length === 0) {
    throw new YouTubeProviderRequiredError();
  }
  return createYouTubeClient(providers);
}

export function getConfiguredYouTubeClient(): YouTubeClient {
  return createConfiguredYouTubeClient(getYouTubeProviderConfiguration());
}
