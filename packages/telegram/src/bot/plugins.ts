import { autoRetry } from "@grammyjs/auto-retry";
import type { Api, RawApi } from "grammy";

/**
 * Default auto-retry configuration
 */
export const DEFAULT_AUTO_RETRY_CONFIG = {
  maxRetries: 3,
  maxDelaySeconds: 60,
  retryOnInternalServerErrors: true,
} as const;

/**
 * Apply auto-retry plugin with default configuration
 */
export function applyAutoRetry(
  api: Api<RawApi>,
  config: {
    maxRetries?: number;
    maxDelaySeconds?: number;
    retryOnInternalServerErrors?: boolean;
  } = {}
): void {
  const finalConfig = {
    ...DEFAULT_AUTO_RETRY_CONFIG,
    ...config,
  };
  api.config.use(autoRetry(finalConfig));
}
