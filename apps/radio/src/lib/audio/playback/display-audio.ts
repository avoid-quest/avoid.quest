export const BROWSER_AUDIO_SOURCES = [
  { id: "browser-audio", name: "Browser / computer audio", url: "" },
  { id: "spotify", name: "Spotify", url: "https://open.spotify.com/" },
  { id: "mixcloud", name: "Mixcloud", url: "https://www.mixcloud.com/" },
  { id: "radio-shows", name: "Radio episodes / shows", url: "" },
] as const;

export type BrowserAudioSource = (typeof BROWSER_AUDIO_SOURCES)[number]["id"];

export function stopCapturedAudio(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/** Must run before awaiting engine setup, while the user's gesture is active. */
export async function requestDisplayAudio(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error(
      "Tab audio sharing is unavailable. Use desktop Chrome or Edge, or an audio input device."
    );
  }
  const options: DisplayMediaStreamOptions & {
    selfBrowserSurface: "exclude";
    surfaceSwitching: "exclude";
    systemAudio: "include";
    windowAudio: "window";
  } = {
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
      suppressLocalAudioPlayback: true,
    } as MediaTrackConstraints,
    selfBrowserSurface: "exclude",
    surfaceSwitching: "exclude",
    systemAudio: "include",
    video: { displaySurface: "browser", frameRate: 1 },
    windowAudio: "window",
  };
  const stream = await navigator.mediaDevices.getDisplayMedia(options);
  if (!stream.getAudioTracks().some((track) => track.readyState === "live")) {
    stopCapturedAudio(stream);
    throw new Error(
      "No audio was shared. Choose a tab and enable Share tab audio, or choose a screen/window that offers audio."
    );
  }
  // Video is required by the browser's picker and remains owned until sharing
  // ends. Only audio is connected to Web Audio; nothing is recorded or uploaded.
  return stream;
}
