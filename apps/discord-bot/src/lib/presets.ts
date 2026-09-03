export type PresetRadio = {
  name: string;
  description: string;
  websiteUrl: string;
  streamUrl: string;
  logoUrl: string;
};

export const presets: PresetRadio[] = [
  {
    description:
      "A community platform for mixes, podcasts, live recordings and releases by independent musicians, sound artists and collectives.",
    logoUrl: "https://f4.bcbits.com/img/0016171260_10.jpg",
    name: "Sygma Radio",
    streamUrl: "https://radio.syg.ma/audio.ogg",
    websiteUrl: "https://radio.syg.ma",
  },
  {
    description:
      "An independent webradio streaming from two physical studios in Lyon and Paris, and a worldwide network of contributors.",
    logoUrl:
      "https://pbs.twimg.com/profile_images/905788826207096833/A53KDDzj_400x400.jpg",
    name: "Lyl Radio",
    streamUrl: "https://icecast.lyl.live/live",
    websiteUrl: "https://lyl.live",
  },
  {
    description:
      "A community experimental radio station based in Wedding, Berlin. Broadcasting underground music, talk shows and live performative arts.",
    logoUrl: "https://cashmereradio.com/cashmere_logo.svg",
    name: "Cashmere Radio",
    streamUrl: "https://cashmereradio.out.airtime.pro/cashmereradio_b",
    websiteUrl: "https://cashmereradio.com/",
  },
  {
    description: "NTS | London Stream",
    logoUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/NTS_Radio_logo.svg/2048px-NTS_Radio_logo.svg.png",
    name: "NTS Radio | Channel 1",
    streamUrl: "https://stream-relay-geo.ntslive.net/stream",
    websiteUrl: "https://www.nts.live",
  },
  {
    description: "NTS | NY Stream",
    logoUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/NTS_Radio_logo.svg/2048px-NTS_Radio_logo.svg.png",
    name: "NTS Radio | Channel 2",
    streamUrl: "https://stream-relay-geo.ntslive.net/stream2",
    websiteUrl: "https://www.nts.live",
  },
  {
    description:
      "Radio Blackout trasmette notizie, approfondimenti, musica e controcultura dal 1992, libera e autogestita.",
    logoUrl: "https://radioblackout.org/logo.png",
    name: "Radio BlackOut",
    streamUrl: "https://zeppelin.streampunk.cc/_stream/blackout.mp3",
    websiteUrl: "https://radioblackout.org/",
  },
  {
    description:
      "Resonance Extra is a 24/7 digital broadcasting platform dedicated to global music, sound art and radio art.",
    logoUrl: "https://extra.resonance.fm/static/media/logo.2d5353a2.svg",
    name: "Resonance Extra",
    streamUrl: "https://stream.resonance.fm/resonance-extra",
    websiteUrl: "https://extra.resonance.fm/",
  },
  {
    description:
      "Internet Public Radio is an independent cultural platform and radio station broadcasting from Guadalajara, Latin America, Europe and more territories.",
    logoUrl:
      "https://www.internetpublicradio.live/static/main-logo.bcb1782f3ce2.svg",
    name: "Internet Public Radio",
    streamUrl: "https://stream-relay-geo.internetpublicradio.live/stream/main",
    websiteUrl: "https://www.internetpublicradio.live/",
  },
  {
    description: "Radio AlHara",
    logoUrl: "https://www.radioalhara.net/img/radio-alhara-logo.svg",
    name: "Radio Alhara",
    streamUrl: "https://n03.radiojar.com/78cxy6wkxtzuv",
    websiteUrl: "https://www.radioalhara.net/",
  },
  {
    description: "",
    logoUrl: "",
    name: "Gatto Misterioso",
    streamUrl:
      "https://azuracast.gattomisterioso.top/listen/gatto_misterioso/radio.mp3",
    websiteUrl: "",
  },
];
