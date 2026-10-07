export type EngineParamTarget =
  | { kind: "effect"; laneId: string; effectId: string; field: string }
  | {
      kind: "chain";
      laneId: string;
      effectId: string;
      chainId: string;
      field: "gain" | "pan";
    }
  | { kind: "pan"; laneId: string }
  | { kind: "filter"; laneId: string; field: "frequency" | "Q" }
  | { kind: "send"; edgeId: string };

export function clampParam(
  value: number,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY
) {
  return Math.max(min, Math.min(max, value));
}

export function paramKey(target: EngineParamTarget): string {
  return JSON.stringify(target, [
    "kind",
    "laneId",
    "effectId",
    "chainId",
    "field",
    "edgeId",
  ]);
}
