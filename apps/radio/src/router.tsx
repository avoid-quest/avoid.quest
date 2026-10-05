import { initClientSentry } from "@avoid.quest/error";
import { createRouter } from "@tanstack/react-router";
import { CLIENT_SENTRY_TUNNEL, readClientSentryDsn } from "@/lib/sentry/tunnel";

// Import the generated route tree
import { routeTree } from "./routeTree.gen";

// Create a new router instance
export const getRouter = () => {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
  });
  if (!router.isServer) {
    initClientSentry({
      dsn: readClientSentryDsn(window.location.hostname),
      environment: import.meta.env.MODE,
      release: `radio@${__APP_VERSION__}`,
      tunnel: CLIENT_SENTRY_TUNNEL,
    });
  }

  return router;
};
