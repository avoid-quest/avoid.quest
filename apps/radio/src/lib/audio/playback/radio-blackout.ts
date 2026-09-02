const RADIO_BLACKOUT_STREAM_URL = "https://s.streampunk.cc/blackout.ogg";

const RADIO_BLACKOUT_STREAM_URLS = new Set([
  "https://zeppelin.streampunk.cc/_stream/blackout.mp3",
  "https://s.streampunk.cc/blackout.mp3",
  RADIO_BLACKOUT_STREAM_URL,
  "https://seep.eu.org/https://s.streampunk.cc/blackout.mp3",
  "https://proxy.cors.sh/https://s.streampunk.cc/blackout.mp3",
  "/api/radio-blackout-stream",
]);

function isRadioBlackoutStreamUrl(url: string): boolean {
  return RADIO_BLACKOUT_STREAM_URLS.has(url);
}

export { isRadioBlackoutStreamUrl, RADIO_BLACKOUT_STREAM_URL };
