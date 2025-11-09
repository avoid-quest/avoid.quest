"use server";
import bcfetch from "bandcamp-fetch";

export async function getBandcampAlbunUrl(
  url: string
): Promise<string | undefined> {
  try {
    const params = {
      albumUrl: url,
      albumImageFormat: "art_app_large",
      artistImageFormat: "bio_featured",
      includeRawData: false,
    };

    const album = await bcfetch.album.getInfo(params);
    if (!album?.tracks) {
      throw new Error("No tracks found");
    }
    return album.tracks[0]?.streamUrl;
  } catch (error) {
    console.error("Error getting bandcamp stream url:", error);
    throw new Error("Failed to get bandcamp stream url");
  }
}

export async function getBandcampTrackUrl(
  url: string
): Promise<string | undefined> {
  try {
    const params = {
      trackUrl: url,
      albumImageFormat: "art_app_large",
      artistImageFormat: "bio_featured",
      includeRawData: false,
    };

    const track = await bcfetch.track.getInfo(params);
    return track?.streamUrl;
  } catch (error) {
    console.error("Error getting bandcamp track url:", error);
    throw new Error("Failed to get bandcamp track url");
  }
}
