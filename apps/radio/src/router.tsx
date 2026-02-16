import { initClientSentry } from "@avoid.quest/error";
import { createRouter } from "@tanstack/react-router";

// Import the generated route tree
import { routeTree } from "./routeTree.gen";

// Create a new router instance
export const getRouter = () => {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });
  if (!router.isServer) {
    const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
    if (dsn) {
      const tunnel =
        (import.meta.env.VITE_SENTRY_TUNNEL as string | undefined) ?? "/tunnel";
      initClientSentry({
        dsn,
        tunnel,
        environment: import.meta.env.MODE,
        release: `radio@${__APP_VERSION__}`,
      });
    }
  }

  return router;
};
