const RADIO_GARDEN_PATTERN = /(?:^|\/{2}|\.)(radio\.garden)(?:\/|$)/i;
const RADIO_GARDEN_LISTEN_PATTERN =
  /radio\.garden\/(?:listen|visit)\/[^/]+\/([a-zA-Z0-9]+)/i;

export function isRadioGardenUrl(url: string): boolean {
  return Boolean(url) && RADIO_GARDEN_PATTERN.test(url);
}

export function extractChannelId(url: string): string | null {
  const match = RADIO_GARDEN_LISTEN_PATTERN.exec(url);
  return match?.[1] ?? null;
}
