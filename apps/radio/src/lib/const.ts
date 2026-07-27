import type { Radio, Settings } from "./types";

export const DEFAULT_TRANSITION_DURATION = 2000;

export const radios: Radio[] = [
  {
    name: "Sygma Radio",
    description:
      "A community platform for mixes, podcasts, live recordings and releases by independent musicians, sound artists and collectives.",
    websiteUrl: "https://radio.syg.ma",
    streamUrl: "https://radio.syg.ma/audio.ogg",
    logoUrl: "https://radio.syg.ma/icons/android-icon-192x192.png",
    metadataConfig: {
      kind: "airtime-live-info",
      urls: ["https://radio.syg.ma/stats-icecast.json"],
    },
    order: 2,
    isSystem: true,
  },
  {
    name: "Lyl Radio",
    description:
      "An independent webradio streaming from two physical studios in Lyon and Paris, and a worldwide network of contributors, listen to the rest now.",
    websiteUrl: "https://lyl.live",
    streamUrl: "https://icecast.lyl.live/live",
    logoUrl:
      "https://pbs.twimg.com/profile_images/905788826207096833/A53KDDzj_400x400.jpg",
    metadataConfig: { kind: "icecast-status" },
    order: 3,
    isSystem: true,
  },
  {
    name: "Cashmere Radio",
    description:
      "A community experimental radio station based in Wedding, Berlin. Broadcasting underground music, talk shows and live performative arts.",
    websiteUrl: "https://cashmereradio.com/",
    logoUrl: "https://cashmereradio.com/cashmere_logo.svg",
    streamUrl: "https://cashmereradio.out.airtime.pro/cashmereradio_b",
    metadataConfig: {
      kind: "airtime-live-info",
      urls: ["https://cashmereradio.airtime.pro/api/live-info-v2"],
    },
    order: 4,
    isSystem: true,
  },
  {
    name: "NTS Radio | Channel 1",
    websiteUrl: "https://www.nts.live",
    description: "NTS | London Stream",
    logoUrl: "https://www.nts.live/apple-touch-icon.png?v=47rE43RRzB",
    streamUrl: "https://streams.radiomast.io/nts1",
    metadataConfig: { kind: "nts-live-api", channel: "1" },
    order: 5,
    isSystem: true,
  },
  {
    name: "NTS Radio | Channel 2",
    websiteUrl: "https://www.nts.live",
    description: "NTS | NY Stream",
    logoUrl: "https://www.nts.live/apple-touch-icon.png?v=47rE43RRzB",
    streamUrl: "https://streams.radiomast.io/nts2",
    metadataConfig: { kind: "nts-live-api", channel: "2" },
    order: 6,
    isSystem: true,
  },
  {
    name: "Radio BlackOut",
    description:
      "Radio Blackout trasmette notizie, approfondimenti, musica e controcultura dal 1992, libera e autogestita.",
    websiteUrl: "https://radioblackout.org/",
    streamUrl: "https://zeppelin.streampunk.cc/_stream/blackout.mp3",
    logoUrl: "https://radioblackout.org/logo.png",
    metadataConfig: { kind: "radio-blackout-api" },
    order: 12,
    isSystem: true,
  },
  {
    name: "Resonance Extra",
    websiteUrl: "https://extra.resonance.fm/",
    description:
      "Resonance Extra is a 24/7 digital broadcasting platform dedicated to global music, sound art and radio art",
    logoUrl: "https://extra.resonance.fm/static/media/logo.2d5353a2.svg",
    streamUrl: "https://stream.resonance.fm/resonance-extra",
    metadataConfig: { kind: "icy" },
    order: 7,
    isSystem: true,
  },
  {
    name: "Internet Public Radio",
    description:
      "Internet Public Radio is an independent cultural platform and radio station broadcasting from Guadalajara, Latin America, Europe and more territories.",
    websiteUrl: "https://www.internetpublicradio.live/",
    logoUrl: "https://www.internetpublicradio.live/logo.svg",
    streamUrl: "https://stream-relay-geo.internetpublicradio.live/stream/main",
    metadataConfig: {
      kind: "airtime-live-info",
      urls: [
        "https://stream-relay-geo.internetpublicradio.live/api-filtered.php",
      ],
    },
    order: 8,
    isSystem: true,
  },
  {
    name: "Radio Alhara",
    description: "Radio AlHara راديو الحارة",
    logoUrl: "https://radioalhara.net/img/radio-alhara-logo.svg",
    websiteUrl: "https://www.radioalhara.net/",
    streamUrl: "https://n03.radiojar.com/78cxy6wkxtzuv",
    metadataConfig: { kind: "icy" },
    order: 11,
    isSystem: true,
  },
];

export const settings: Settings = {
  player: {
    mode: "single",
    restoreStateOnLoad: true,
    single: {
      transitionDuration: DEFAULT_TRANSITION_DURATION,
    },
  },
};
