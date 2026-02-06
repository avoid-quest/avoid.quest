// biome-ignore lint/performance/noNamespaceImport: we need to use the namespace import for Sentry
import * as Sentry from "@sentry/tanstackstart-react";
import { createRouter } from "@tanstack/react-router";

// Import the generated route tree
import { routeTree } from "./routeTree.gen";

// Only propagate Sentry trace headers to same-origin (first-party) requests.
// Relative URLs start with "/" and are always same-origin.
const FIRST_PARTY_ROUTE = /^\//;

// Create a new router instance
export const getRouter = () => {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });
  if (!router.isServer) {
    Sentry.init({
      dsn: "https://444829d47e194352a94b3739c56ca4ee@o4510834344656896.ingest.de.sentry.io/4510834349375568",
      tunnel: "/tunnel",
      environment: import.meta.env.MODE,
      release: `radio@${__APP_VERSION__}`,
      // Adds request headers and IP for users, for more info visit:
      // https://docs.sentry.io/platforms/javascript/guides/tanstackstart-react/configuration/options/#sendDefaultPii
      sendDefaultPii: true,

      integrations: [
        Sentry.tanstackRouterBrowserTracingIntegration(router),
        Sentry.replayIntegration(),
      ],

      tracesSampleRate: 0.2,
      tracePropagationTargets: [FIRST_PARTY_ROUTE],
      // Capture Replay for 10% of all sessions,
      // plus for 100% of sessions with an error.
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
    });
  }

  return router;
};
