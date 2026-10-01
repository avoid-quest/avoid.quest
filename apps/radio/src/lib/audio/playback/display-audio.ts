export const BROWSER_AUDIO_SOURCES = [
  { id: "browser-audio", name: "Browser tab audio", url: "" },
  { id: "spotify", name: "Spotify", url: "https://open.spotify.com/" },
  { id: "mixcloud", name: "Mixcloud", url: "https://www.mixcloud.com/" },
  { id: "radio-shows", name: "Radio episodes / shows", url: "" },
] as const;

export type BrowserAudioSource = (typeof BROWSER_AUDIO_SOURCES)[number]["id"];

/** A sharing failure whose message is written for the user as it is. */
export class DisplayAudioError extends Error {
  /** The user closed the picker or declined to share. */
  readonly cancelled: boolean;

  constructor(message: string, { cancelled = false } = {}) {
    super(message);
    this.name = "DisplayAudioError";
    this.cancelled = cancelled;
  }
}

/** A closed or declined share picker: nothing went wrong to report. */
export function isDisplayAudioCancel(error: unknown): boolean {
  return error instanceof DisplayAudioError && error.cancelled;
}

function pickerError(error: unknown): unknown {
  const name = error instanceof Error ? error.name : null;
  if (name === "NotAllowedError") {
    return new DisplayAudioError("Sharing was cancelled.", { cancelled: true });
  }
  if (name === "InvalidStateError") {
    return new DisplayAudioError(
      "Tab audio sharing must start from a click. Try again."
    );
  }
  return error;
}

export function stopCapturedAudio(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/**
 * Only another tab's audio may be shared. Screen (system) and window audio
 * can contain this page's own output, which the mixer would then play back
 * into the capture: a feedback loop. The options below are hints, so a
 * capture not reported as a browser tab is refused afterwards, including one
 * whose surface is unknown. Only Chromium shares tab audio, and it reports it.
 *
 * Must run before awaiting engine setup, while the user's gesture is active.
 */
export async function requestDisplayAudio(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new DisplayAudioError(
      "Tab audio sharing is unavailable. Use desktop Chrome or Edge, or an audio input device."
    );
  }
  const options: DisplayMediaStreamOptions & {
    monitorTypeSurfaces: "exclude";
    selfBrowserSurface: "exclude";
    surfaceSwitching: "exclude";
    systemAudio: "exclude";
    windowAudio: "exclude";
  } = {
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
      restrictOwnAudio: true,
      suppressLocalAudioPlayback: true,
    } as MediaTrackConstraints,
    monitorTypeSurfaces: "exclude",
    selfBrowserSurface: "exclude",
    surfaceSwitching: "exclude",
    systemAudio: "exclude",
    video: { displaySurface: "browser", frameRate: 1 },
    windowAudio: "exclude",
  };
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(options);
  } catch (error) {
    throw pickerError(error);
  }
  const surface = stream.getVideoTracks?.()[0]?.getSettings?.().displaySurface;
  if (surface !== "browser") {
    stopCapturedAudio(stream);
    throw new DisplayAudioError(
      "Share a browser tab. Screen and window audio can include this mixer and feed back into it."
    );
  }
  if (!stream.getAudioTracks().some((track) => track.readyState === "live")) {
    stopCapturedAudio(stream);
    throw new DisplayAudioError(
      "No audio was shared. Choose a tab and enable Share tab audio."
    );
  }
  // Video is required by the browser's picker and remains owned until sharing
  // ends. Only audio is connected to Web Audio; nothing is recorded or uploaded.
  return stream;
}
