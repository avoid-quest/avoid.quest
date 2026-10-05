import { makeSentryOptions } from "@avoid.quest/error";
import { withSentry } from "@sentry/cloudflare";
import handler from "@tanstack/react-start/server-entry";

type SentryEnv = {
  RADIO_SENTRY_DSN?: string;
  SENTRY_DSN?: string;
};

// withSentry owns per-request isolation and waitUntil delivery in Workers.
export default withSentry<SentryEnv>(
  (env: SentryEnv) =>
    makeSentryOptions({
      dsn: (env.RADIO_SENTRY_DSN || env.SENTRY_DSN || "").trim(),
      environment: import.meta.env.MODE,
      release: __SENTRY_RELEASE__,
    }),
  // @ts-expect-error TanStack types its second argument as Start options, not Worker bindings.
  handler
);
