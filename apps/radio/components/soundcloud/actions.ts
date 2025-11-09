"use server";

import { fetchClientID } from "@scdl/fetch-client";
import { setClientID, stream } from "scdl-core";

export async function getSoundCloudStreamUrl(url: string): Promise<string> {
  try {
    // Get and set client ID
    const clientID = await fetchClientID();
    setClientID(clientID);

    // Stream the track
    const streamResult = await stream(url);

    // Convert the stream to a Buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of streamResult) {
      chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
    }

    // Combine all chunks into a single buffer
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // Convert to base64
    const base64 = Buffer.from(combined).toString("base64");

    // Determine content type from transcoding if available
    const contentType =
      streamResult.transcoding?.format.mime_type || "audio/mpeg";

    // Return as data URL
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.error("Error streaming SoundCloud track:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to stream SoundCloud track: ${errorMessage}`);
  }
}

