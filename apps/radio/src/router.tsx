import { initClientSentry } from "@avoid.quest/error";
import { createRouter } from "@tanstack/react-router";
import { CLIENT_SENTRY_DSN, CLIENT_SENTRY_TUNNEL } from "@/lib/sentry/tunnel";

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
      dsn: CLIENT_SENTRY_DSN,
      tunnel: CLIENT_SENTRY_TUNNEL,
      environment: import.meta.env.MODE,
      release: `radio@${__APP_VERSION__}`,
    });
  }

  return router;
};
