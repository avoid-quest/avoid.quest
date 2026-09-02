const RADIO_BLACKOUT_STREAM_URL = "/api/radio-blackout-stream";

const RADIO_BLACKOUT_STREAM_URLS = new Set([
  "https://zeppelin.streampunk.cc/_stream/blackout.mp3",
  "https://s.streampunk.cc/blackout.mp3",
  "https://seep.eu.org/https://s.streampunk.cc/blackout.mp3",
  "https://proxy.cors.sh/https://s.streampunk.cc/blackout.mp3",
  RADIO_BLACKOUT_STREAM_URL,
]);

function isRadioBlackoutStreamUrl(url: string): boolean {
  return RADIO_BLACKOUT_STREAM_URLS.has(url);
}

export { isRadioBlackoutStreamUrl, RADIO_BLACKOUT_STREAM_URL };
