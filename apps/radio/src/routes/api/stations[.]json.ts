import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { radios } from "@/lib/const";
import { getPublicKodiStations } from "@/lib/kodi-playlist";

const STATIONS_CACHE_CONTROL =
  "public, max-age=300, stale-while-revalidate=3600";

export const Route = createFileRoute("/api/stations.json")({
  server: {
    handlers: {
      GET: () => {
        return json(
          {
            stations: getPublicKodiStations(radios),
          },
          {
            headers: {
              "Cache-Control": STATIONS_CACHE_CONTROL,
            },
          }
        );
      },
    },
  },
});
