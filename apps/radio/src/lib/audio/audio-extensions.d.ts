/**
 * Type declarations for Web Audio API extensions not yet in TypeScript's lib.dom.d.ts
 *
 * AudioContext.setSinkId: Routes audio output to a specific device (Chrome/Edge)
 * HTMLMediaElement.setSinkId is already typed in lib.dom.d.ts (TS 5.9+)
 */

// biome-ignore lint/style/useConsistentTypeDefinitions: interface needed for declaration merging with global AudioContext
interface AudioContext {
  setSinkId(sinkId: string): Promise<void>;
}
