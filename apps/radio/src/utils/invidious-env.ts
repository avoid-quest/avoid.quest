import type { InvidiousOptions } from "@avoid.quest/platforms";

type InvidiousEnv = {
  readonly INVIDIOUS_INSTANCE_URL?: string;
  readonly INVIDIOUS_AUTH?: string;
};

export function readInvidiousOptions(bindings: unknown): InvidiousOptions {
  const env = bindings as InvidiousEnv;
  return {
    instanceUrl: env.INVIDIOUS_INSTANCE_URL || undefined,
    auth: env.INVIDIOUS_AUTH || undefined,
  };
}
