// biome-ignore lint/performance/noNamespaceImport: namespace import required by Sentry SDK
import * as Sentry from "@sentry/react";
import { makeSentryOptions, shouldDropKnownBrowserApiNoise } from "./index";

export function initClientSentry(config: {
  dsn: string;
  environment: string;
  release: string;
  tunnel?: string;
}): void {
  if (!config.dsn || Sentry.getClient()) {
    return;
  }

  Sentry.init({
    ...makeSentryOptions(config),
    beforeSend(event) {
      return shouldDropKnownBrowserApiNoise(event) ? null : event;
    },
    // Stream paths and console arguments can contain private URLs. Keep SDK
    // event breadcrumbs; callers attach bounded application context separately.
    integrations: [
      Sentry.breadcrumbsIntegration({
        dom: false,
        fetch: false,
        history: false,
        xhr: false,
      }),
    ],
    tunnel: config.tunnel,
  });
}
