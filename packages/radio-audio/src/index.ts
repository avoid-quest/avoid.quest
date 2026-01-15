// Re-export from cacophony for convenience
export type { AudioError, AudioState } from "@avoid.quest/cacophony";
export * from "@avoid.quest/cacophony";
export { AudioManager } from "@avoid.quest/cacophony";
// Hooks
export { useAudio } from "./hooks/use-audio";
export { useDjAudio } from "./hooks/use-dj-audio";
export { useSingleAudio } from "./hooks/use-single-audio";
