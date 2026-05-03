import { createFileRoute } from "@tanstack/react-router";
import { radios } from "@/lib/const";
import {
  getPublicKodiStations,
  renderKodiM3uPlaylist,
} from "@/lib/kodi-playlist";

const PLAYLIST_CACHE_CONTROL =
  "public, max-age=300, stale-while-revalidate=3600";

export const Route = createFileRoute("/playlist.m3u")({
  server: {
    handlers: {
      GET: () => {
        const stations = getPublicKodiStations(radios);
        const playlist = renderKodiM3uPlaylist(stations);

        return new Response(playlist, {
          headers: {
            "Cache-Control": PLAYLIST_CACHE_CONTROL,
            "Content-Type": "audio/x-mpegurl; charset=utf-8",
          },
        });
      },
    },
  },
});
