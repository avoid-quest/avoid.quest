import { BandcampPlayer } from "@/components/bandcamp/bandcamp-player";
import { SoundCloudPlayer } from "@/components/soundcloud";

const SOUNDCLOUD_URL = "https://soundcloud.com/ducktrshessami/unfinished";
const BANDCAMP_URL = "https://musique.coeurdepirate.com/track/tes-belle";

export default function Testing() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div>Test Soundcloud:</div>
      <SoundCloudPlayer url={SOUNDCLOUD_URL} />
      <div>Test Bandcamp:</div>
      <BandcampPlayer url={BANDCAMP_URL} />
    </div>
  );
}
