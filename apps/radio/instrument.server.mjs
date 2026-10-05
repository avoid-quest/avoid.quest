import { initServerSentry } from "@avoid.quest/error";

const SENTRY_DSN =
  process.env.RADIO_SENTRY_DSN ||
  process.env.SENTRY_DSN ||
  process.env.VITE_RADIO_SENTRY_DSN ||
  "";

initServerSentry({
  dsn: SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  release: `radio@${process.env.npm_package_version || "0.7.0"}`,
});
