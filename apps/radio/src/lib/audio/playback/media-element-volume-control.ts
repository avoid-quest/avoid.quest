export function supportsMediaElementVolumeControl(): boolean {
  if (typeof globalThis.Audio === "undefined") {
    return false;
  }
  const audio = new Audio();
  const originalVolume = audio.volume;
  const probeVolume = originalVolume === 0.5 ? 0.25 : 0.5;

  try {
    audio.volume = probeVolume;
    return audio.volume === probeVolume;
  } catch {
    return false;
  } finally {
    try {
      audio.volume = originalVolume;
    } catch {
      // Some browsers expose a read-only media volume property.
    }
  }
}
