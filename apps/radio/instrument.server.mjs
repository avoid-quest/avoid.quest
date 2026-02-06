// biome-ignore lint/performance/noNamespaceImport: namespace import required for Sentry
import * as Sentry from "@sentry/tanstackstart-react";

Sentry.init({
  dsn: "https://444829d47e194352a94b3739c56ca4ee@o4510834344656896.ingest.de.sentry.io/4510834349375568",
  environment: process.env.NODE_ENV || "development",
  release: `radio@${process.env.npm_package_version || "0.5.0"}`,

  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  sendDefaultPii: true,

  tracesSampleRate: 0.2,
});
