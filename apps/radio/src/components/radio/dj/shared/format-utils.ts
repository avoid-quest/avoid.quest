export function formatPan(pan: number): string {
  if (Math.abs(pan) < 0.05) {
    return "C";
  }
  const percent = Math.abs(Math.round(pan * 100));
  return pan < 0 ? `L${percent}` : `R${percent}`;
}

export function formatChannelFilter(value: number): string {
  if (Math.abs(value) < 0.05) {
    return "OFF";
  }
  return value < 0
    ? `LP ${Math.round(Math.abs(value) * 100)}%`
    : `HP ${Math.round(value * 100)}%`;
}

export function formatSpeed(speed: number): string {
  return `${speed.toFixed(2)}x`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatTime(seconds: number): string {
  if (!seconds || Number.isNaN(seconds)) {
    return "0:00";
  }
  if (!Number.isFinite(seconds)) {
    return "LIVE";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
