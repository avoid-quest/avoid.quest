export function laneChannelId(nodeId: string): string {
  return `n:${nodeId}`;
}

export function laneSoundId(nodeId: string): string {
  return `node:${laneChannelId(nodeId)}`;
}
