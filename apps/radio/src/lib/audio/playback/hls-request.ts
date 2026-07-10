import {
  cachePublicHostnameResolver,
  type PublicHostnameResolver,
  resolvePublicHostnameWithDoh,
  validateResolvedPublicHttpUrl,
} from "@avoid.quest/platforms/url-policy";

type HlsLoaderContext = { url: string };

type HlsFetchSetupOptions = {
  credentials?: RequestCredentials;
  resolveHostname?: PublicHostnameResolver | false;
};

export function createValidatedHlsFetchSetup({
  credentials = "omit",
  resolveHostname = resolvePublicHostnameWithDoh,
}: HlsFetchSetupOptions = {}) {
  const cachedResolveHostname: PublicHostnameResolver | false =
    resolveHostname === false
      ? false
      : cachePublicHostnameResolver(resolveHostname);

  return async (
    context: HlsLoaderContext,
    init: RequestInit
  ): Promise<Request> => {
    const validation = await validateResolvedPublicHttpUrl(context.url, {
      resolveHostname: cachedResolveHostname,
      signal: init.signal ?? undefined,
    });
    if (!validation.ok) {
      throw new Error("HLS contains an unsafe HLS resource URL");
    }

    return new Request(validation.url, {
      ...init,
      credentials,
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  };
}
