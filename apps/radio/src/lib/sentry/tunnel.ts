const LEADING_SLASH_PATTERN = /^\//;
// Public ingestion key, used only on the first-party production hostname.
const DEFAULT_CLIENT_SENTRY_DSN =
  "https://444829d47e194352a94b3739c56ca4ee@o4510834344656896.ingest.de.sentry.io/4510834349375568";

export const CLIENT_SENTRY_TUNNEL = "/tunnel";
export const MAX_TUNNEL_ENVELOPE_BYTES = 1_000_000;

export function readClientSentryDsn(hostname: string): string {
  const configuredDsn = import.meta.env.VITE_RADIO_SENTRY_DSN;
  if (configuredDsn !== undefined) {
    return configuredDsn.trim();
  }
  return import.meta.env.PROD && hostname === "radio.avoid.quest"
    ? DEFAULT_CLIENT_SENTRY_DSN
    : "";
}

export type SentryTunnelTarget = {
  host: string;
  projectId: string;
};

export function parseSentryDsn(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function getProjectIdFromDsn(dsn: URL): string | null {
  const projectId = dsn.pathname.replace(LEADING_SLASH_PATTERN, "").trim();
  return projectId || null;
}

export function resolveTunnelTarget(config: {
  runtimeDsn?: string | null;
  fallbackDsn?: string | null;
}): SentryTunnelTarget | null {
  const runtimeDsn = config.runtimeDsn?.trim();
  if (runtimeDsn) {
    const parsedRuntimeDsn = parseSentryDsn(runtimeDsn);
    if (!parsedRuntimeDsn) {
      return null;
    }

    const runtimeProjectId = getProjectIdFromDsn(parsedRuntimeDsn);
    if (!runtimeProjectId) {
      return null;
    }

    return {
      host: parsedRuntimeDsn.hostname.toLowerCase(),
      projectId: runtimeProjectId,
    };
  }

  const fallbackDsn = config.fallbackDsn?.trim();
  if (fallbackDsn) {
    const parsedFallbackDsn = parseSentryDsn(fallbackDsn);
    if (!parsedFallbackDsn) {
      return null;
    }

    const fallbackProjectId = getProjectIdFromDsn(parsedFallbackDsn);
    if (!fallbackProjectId) {
      return null;
    }

    return {
      host: parsedFallbackDsn.hostname.toLowerCase(),
      projectId: fallbackProjectId,
    };
  }

  return null;
}

export function readEnvelopeHeader(
  envelope: ArrayBuffer
): { dsn?: string } | null {
  const bytes = new Uint8Array(envelope);
  const headerEnd = bytes.indexOf(10);
  if (headerEnd <= 0) {
    return null;
  }

  const headerLine = new TextDecoder()
    .decode(envelope.slice(0, headerEnd))
    .trim();
  if (!headerLine) {
    return null;
  }

  try {
    const parsed = JSON.parse(headerLine) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed as { dsn?: string };
  } catch {
    return null;
  }
}

export function isAllowedEnvelopeDsn(
  dsn: string | undefined,
  target: SentryTunnelTarget
): boolean {
  if (!dsn) {
    return false;
  }

  const envelopeDsn = parseSentryDsn(dsn);
  if (!envelopeDsn) {
    return false;
  }

  const envelopeProjectId = getProjectIdFromDsn(envelopeDsn);
  if (!envelopeProjectId) {
    return false;
  }

  return (
    envelopeDsn.hostname.toLowerCase() === target.host &&
    envelopeProjectId === target.projectId
  );
}
