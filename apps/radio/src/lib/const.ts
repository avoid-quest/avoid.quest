import type { Radio, Settings } from "./types";

export const radios: Radio[] = [
  {
    description:
      "A community platform for mixes, podcasts, live recordings and releases by independent musicians, sound artists and collectives.",
    isSystem: true,
    logoUrl: "https://radio.syg.ma/icons/android-icon-192x192.png",
    metadataConfig: {
      kind: "airtime-live-info",
      urls: ["https://radio.syg.ma/stats-icecast.json"],
    },
    name: "Sygma Radio",
    order: 2,
    streamUrl: "https://radio.syg.ma/audio.mp3",
    websiteUrl: "https://radio.syg.ma",
  },
  {
    description:
      "An independent webradio streaming from two physical studios in Lyon and Paris, and a worldwide network of contributors, listen to the rest now.",
    isSystem: true,
    logoUrl:
      "https://pbs.twimg.com/profile_images/905788826207096833/A53KDDzj_400x400.jpg",
    metadataConfig: { kind: "lyl-api" },
    name: "Lyl Radio",
    order: 3,
    streamUrl: "https://icecast.lyl.live/live",
    websiteUrl: "https://lyl.live",
  },
  {
    description:
      "A community experimental radio station based in Wedding, Berlin. Broadcasting underground music, talk shows and live performative arts.",
    isSystem: true,
    logoUrl: "https://cashmereradio.com/cashmere_logo.svg",
    metadataConfig: {
      kind: "airtime-live-info",
      urls: ["https://cashmereradio.airtime.pro/api/live-info-v2"],
    },
    name: "Cashmere Radio",
    order: 4,
    streamUrl: "https://cashmereradio.out.airtime.pro/cashmereradio_b",
    websiteUrl: "https://cashmereradio.com/",
  },
  {
    description: "NTS | London Stream",
    isSystem: true,
    logoUrl: "https://www.nts.live/apple-touch-icon.png?v=47rE43RRzB",
    metadataConfig: { channel: "1", kind: "nts-live-api" },
    name: "NTS Radio | Channel 1",
    order: 5,
    streamUrl: "https://streams.radiomast.io/nts1",
    websiteUrl: "https://www.nts.live",
  },
  {
    description: "NTS | NY Stream",
    isSystem: true,
    logoUrl: "https://www.nts.live/apple-touch-icon.png?v=47rE43RRzB",
    metadataConfig: { channel: "2", kind: "nts-live-api" },
    name: "NTS Radio | Channel 2",
    order: 6,
    streamUrl: "https://streams.radiomast.io/nts2",
    websiteUrl: "https://www.nts.live",
  },
  {
    description:
      "Radio Blackout trasmette notizie, approfondimenti, musica e controcultura dal 1992, libera e autogestita.",
    isSystem: true,
    logoUrl: "https://radioblackout.org/logo.png",
    metadataConfig: { kind: "radio-blackout-api" },
    name: "Radio BlackOut",
    order: 12,
    streamUrl: "https://zeppelin.streampunk.cc/_stream/blackout.mp3",
    websiteUrl: "https://radioblackout.org/",
  },
  {
    description:
      "Resonance Extra is a 24/7 digital broadcasting platform dedicated to global music, sound art and radio art",
    isSystem: true,
    logoUrl: "https://extra.resonance.fm/static/media/logo.2d5353a2.svg",
    metadataConfig: { kind: "resonance-extra-api" },
    name: "Resonance Extra",
    order: 7,
    streamUrl: "https://stream.resonance.fm/resonance-extra",
    websiteUrl: "https://extra.resonance.fm/",
  },
  {
    description:
      "Internet Public Radio is an independent cultural platform and radio station broadcasting from Guadalajara, Latin America, Europe and more territories.",
    isSystem: true,
    logoUrl: "https://www.internetpublicradio.live/logo.svg",
    metadataConfig: {
      kind: "airtime-live-info",
      urls: [
        "https://stream-relay-geo.internetpublicradio.live/api-filtered.php",
      ],
    },
    name: "Internet Public Radio",
    order: 8,
    streamUrl: "https://stream-relay-geo.internetpublicradio.live/stream/main",
    websiteUrl: "https://www.internetpublicradio.live/",
  },
  {
    description:
      "A community platform and independent radio station featuring underground music from Hong Kong, Asia and around the world.",
    isSystem: true,
    logoUrl: "https://hkcr.live/assets/logo.png",
    metadataConfig: { kind: "hkcr-schedule" },
    name: "HKCR",
    order: 9,
    streamFormat: "hls",
    streamUrl: "https://stream-test.hkcr.live/hls/main.m3u8",
    websiteUrl: "https://hkcr.live/",
  },
  {
    description: "Radio AlHara راديو الحارة",
    isSystem: true,
    logoUrl: "https://radioalhara.net/img/radio-alhara-logo.svg",
    metadataConfig: { kind: "radio-alhara-api" },
    name: "Radio Alhara",
    order: 11,
    streamUrl: "https://n03.radiojar.com/78cxy6wkxtzuv",
    websiteUrl: "https://www.radioalhara.net/",
  },
];

export const settings: Settings = {
  player: {
    mode: "single",
    restoreStateOnLoad: true,
  },
};

/** When this browser last opened the "What's new" list. */
export const CHANGELOG_STORAGE_KEY = "radio-changelog-seen";
