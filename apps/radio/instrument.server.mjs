import { initServerSentry } from "@avoid.quest/error";

const dsn = process.env.SENTRY_DSN || process.env.VITE_SENTRY_DSN;

if (dsn) {
  initServerSentry({
    dsn,
    environment: process.env.NODE_ENV || "development",
    release: `radio@${process.env.npm_package_version || "0.5.0"}`,
  });
}
