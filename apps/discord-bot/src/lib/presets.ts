export type PresetRadio = {
  name: string;
  description: string;
  websiteUrl: string;
  streamUrl: string;
  logoUrl: string;
};

export const presets: PresetRadio[] = [
  {
    name: "Sygma Radio",
    description:
      "A community platform for mixes, podcasts, live recordings and releases by independent musicians, sound artists and collectives.",
    websiteUrl: "https://radio.syg.ma",
    streamUrl: "https://radio.syg.ma/audio.ogg",
    logoUrl: "https://f4.bcbits.com/img/0016171260_10.jpg",
  },
  {
    name: "Lyl Radio",
    description:
      "An independent webradio streaming from two physical studios in Lyon and Paris, and a worldwide network of contributors.",
    websiteUrl: "https://lyl.live",
    streamUrl: "https://icecast.lyl.live/live",
    logoUrl:
      "https://pbs.twimg.com/profile_images/905788826207096833/A53KDDzj_400x400.jpg",
  },
  {
    name: "Cashmere Radio",
    description:
      "A community experimental radio station based in Wedding, Berlin. Broadcasting underground music, talk shows and live performative arts.",
    websiteUrl: "https://cashmereradio.com/",
    streamUrl: "https://cashmereradio.out.airtime.pro/cashmereradio_b",
    logoUrl: "https://cashmereradio.com/cashmere_logo.svg",
  },
  {
    name: "NTS Radio | Channel 1",
    description: "NTS | London Stream",
    websiteUrl: "https://www.nts.live",
    streamUrl: "https://stream-relay-geo.ntslive.net/stream",
    logoUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/NTS_Radio_logo.svg/2048px-NTS_Radio_logo.svg.png",
  },
  {
    name: "NTS Radio | Channel 2",
    description: "NTS | NY Stream",
    websiteUrl: "https://www.nts.live",
    streamUrl: "https://stream-relay-geo.ntslive.net/stream2",
    logoUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/NTS_Radio_logo.svg/2048px-NTS_Radio_logo.svg.png",
  },
  {
    name: "Radio BlackOut",
    description:
      "Radio Blackout trasmette notizie, approfondimenti, musica e controcultura dal 1992, libera e autogestita.",
    websiteUrl: "https://radioblackout.org/",
    streamUrl: "https://blimp.streampunk.cc/_stream/blackout.mp3",
    logoUrl: "https://radioblackout.org/logo.png",
  },
  {
    name: "Resonance Extra",
    description:
      "Resonance Extra is a 24/7 digital broadcasting platform dedicated to global music, sound art and radio art.",
    websiteUrl: "https://extra.resonance.fm/",
    streamUrl: "https://stream.resonance.fm/resonance-extra",
    logoUrl: "https://extra.resonance.fm/static/media/logo.2d5353a2.svg",
  },
  {
    name: "Internet Public Radio",
    description:
      "Internet Public Radio is an independent cultural platform and radio station broadcasting from Guadalajara, Latin America, Europe and more territories.",
    websiteUrl: "https://www.internetpublicradio.live/",
    streamUrl: "https://stream-relay-geo.internetpublicradio.live/stream/main",
    logoUrl:
      "https://www.internetpublicradio.live/static/main-logo.bcb1782f3ce2.svg",
  },
  {
    name: "Radio Alhara",
    description: "Radio AlHara",
    websiteUrl: "https://www.radioalhara.net/",
    streamUrl: "https://n03.radiojar.com/78cxy6wkxtzuv",
    logoUrl: "https://www.radioalhara.net/img/radio-alhara-logo.svg",
  },
  {
    name: "Gatto Misterioso",
    description: "",
    websiteUrl: "",
    streamUrl:
      "https://azuracast.gattomisterioso.top/listen/gatto_misterioso/radio.mp3",
    logoUrl: "",
  },
];
