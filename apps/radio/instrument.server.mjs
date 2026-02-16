import { initServerSentry } from "@avoid.quest/error";

const SENTRY_DSN =
  "https://444829d47e194352a94b3739c56ca4ee@o4510834344656896.ingest.de.sentry.io/4510834349375568";

initServerSentry({
  dsn: SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  release: `radio@${process.env.npm_package_version || "0.5.0"}`,
});
