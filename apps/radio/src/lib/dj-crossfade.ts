function calculateDjCrossfadeVolumes(
  position: number,
  leftVolume: number,
  rightVolume: number
): [left: number, right: number] {
  const angle = (position * Math.PI) / 2;
  return [Math.cos(angle) * leftVolume, Math.sin(angle) * rightVolume];
}

export { calculateDjCrossfadeVolumes };
