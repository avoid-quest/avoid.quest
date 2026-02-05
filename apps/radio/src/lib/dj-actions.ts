/**
 * DJ Audio Actions Module
 *
 * This module provides audio-related actions for the DJ player.
 * It uses TanStack DB collections for persisted state and
 * TanStack Store for runtime state.
 */

import { resolveStreamUrl } from "@avoid.quest/youtube";
import type {
  ChannelSelection,
  EffectConfig,
  EffectType,
  FilterConfig,
} from "@/lib/audio";
import {
  AudioManager,
  type CueBus,
  createCueBus,
  createDefaultEffectConfig,
  createOutputRouter,
  getAudioContext,
  type OutputRouter,
  type Radio,
} from "@/lib/audio";
import {
  extractFileMetadata,
  revokeFileObjectUrl,
} from "@/lib/audio/file-metadata";
import {
  getAudioSettings,
  getDeckA,
  getDeckB,
  getDelaySettings,
  getMixer,
  resetDeck as resetDeckDb,
  setCueDelayMs as setCueDelayMsSetting,
  setMainDelayMs as setMainDelayMsSetting,
  updateDeckA,
  updateDeckB,
  updateMixer,
} from "@/lib/collections";
import type { DeckRecord } from "@/lib/collections/dj-state";
import {
  type DeviceInputMetadata,
  type FileMetadata,
  isDeviceInputMetadata,
  isFileMetadata,
  isYouTubeMetadata,
} from "@/lib/platform-types";
import {
  getDeckARuntime,
  getDeckASubscriptionCleanup,
  getDeckBRuntime,
  getDeckBSubscriptionCleanup,
  resetDeckARuntime,
  resetDeckBRuntime,
  setDeckARuntimeState,
  setDeckASoundId,
  setDeckASubscriptionCleanup,
  setDeckBRuntimeState,
  setDeckBSoundId,
  setDeckBSubscriptionCleanup,
  setDjError,
} from "@/lib/stores/dj-runtime-store";

export type DeckSide = "left" | "right";
type DeckId = "deck-a" | "deck-b";

/**
 * Typed accessor for DeckRecord.effects.
 * The Zod schema uses `type: z.string()` + `.passthrough()`, so the inferred type
 * has `type: string` instead of `EffectType`. At runtime the values are valid
 * EffectConfig objects — this helper bridges the type gap without `as` casts.
 */
function getDeckEffects(deck: DeckRecord): EffectConfig[] {
  return deck.effects as unknown as EffectConfig[];
}

function getDeckRadio(deck: DeckRecord): Radio | null {
  return deck.radio;
}

// Lazy initialization of AudioManager to avoid SSR issues
let audioManager: AudioManager | null = null;

const getAudioManager = (): AudioManager => {
  if (typeof window === "undefined") {
    throw new Error("AudioManager can only be used in browser environment");
  }
  if (!audioManager) {
    audioManager = AudioManager.getInstance();
  }
  return audioManager;
};

// Lazy initialization of CueBus for pre-fader monitoring
let cueBus: CueBus | null = null;

/**
 * Get or create the CueBus instance
 * Requires AudioContext to be available (user gesture)
 */
export const getCueBus = (audioContext: AudioContext): CueBus => {
  if (typeof window === "undefined") {
    throw new Error("CueBus can only be used in browser environment");
  }
  if (!cueBus) {
    cueBus = createCueBus(audioContext, {
      onHeadphoneVolumeChange: (volume) => {
        updateMixer((draft) => {
          draft.headphoneVolume = volume;
        });
      },
      onDeckCueChange: (deckId, enabled) => {
        updateMixer((draft) => {
          if (deckId === "deck-a") {
            draft.deckACueEnabled = enabled;
          } else if (deckId === "deck-b") {
            draft.deckBCueEnabled = enabled;
          }
        });
      },
    });

    // Register both decks
    cueBus.registerDeck("deck-a");
    cueBus.registerDeck("deck-b");

    // Restore state from persisted mixer
    const mixer = getMixer();
    if (mixer) {
      if (mixer.headphoneVolume !== undefined) {
        cueBus.setHeadphoneVolume(mixer.headphoneVolume);
      }
      if (mixer.deckACueEnabled) {
        cueBus.setCueEnabled("deck-a", true);
      }
      if (mixer.deckBCueEnabled) {
        cueBus.setCueEnabled("deck-b", true);
      }
    }
  }
  return cueBus;
};

/**
 * Check if CueBus is initialized
 */
export const isCueBusInitialized = (): boolean => cueBus !== null;

// Lazy initialization of OutputRouter for device selection
let outputRouter: OutputRouter | null = null;

/**
 * Get or create the OutputRouter instance
 */
const getOutputRouter = (): OutputRouter | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const context = getAudioContext();
  if (!context) {
    return null;
  }

  if (!outputRouter) {
    outputRouter = createOutputRouter(context, {
      onError: (error) => {
        setDjError(error.message);
      },
    });
  }

  return outputRouter;
};

/**
 * Apply main output device setting
 * Called when user changes the main output in settings
 */
export async function applyMainOutputDevice(deviceId: string): Promise<void> {
  const router = getOutputRouter();
  if (router) {
    await router.setMainOutput(deviceId);
  }
}

/**
 * Apply CUE output device setting
 * Called when user changes the CUE output in settings
 * Routes CUE audio to the specified device via MediaStream bridge
 * Note: CueBus handles actual audio routing; OutputRouter CUE is not used
 */
export async function applyCueOutputDevice(
  deviceId: string | null
): Promise<void> {
  // CueBus handles actual audio routing via MediaStream bridge
  const bus = ensureCueBus();
  if (bus) {
    await bus.setCueOutputDevice(deviceId);

    // When disabling CUE, reset deck CUE state so no stale state remains
    if (!deviceId) {
      bus.setCueEnabled("deck-a", false);
      bus.setCueEnabled("deck-b", false);
      updateMixer((draft) => {
        draft.deckACueEnabled = false;
        draft.deckBCueEnabled = false;
      });
    }
  }
}

// Track if we've initialized audio devices from settings
let audioDevicesInitialized = false;

/**
 * Apply current audio settings (devices and delays)
 * Reusable function - called on init AND when settings change
 */
export async function applyCurrentAudioSettings(): Promise<void> {
  const router = getOutputRouter();
  if (!router) {
    return;
  }

  try {
    const settings = getAudioSettings();
    if (settings.mainOutputId && settings.mainOutputId !== "default") {
      await router.setMainOutput(settings.mainOutputId);
    }
    if (settings.cueOutputId) {
      // CueBus handles actual audio routing
      const bus = ensureCueBus();
      if (bus) {
        await bus.setCueOutputDevice(settings.cueOutputId);
      }
    }

    // Apply output delays from saved settings
    const delaySettings = getDelaySettings();
    if (delaySettings.mainDelayMs > 0) {
      getAudioManager().setMainDelay(delaySettings.mainDelayMs);
    }
    if (delaySettings.cueDelayMs > 0) {
      const bus = ensureCueBus();
      if (bus) {
        bus.setCueDelay(delaySettings.cueDelayMs);
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to apply audio settings";
    setDjError(message);
  }
}

/**
 * Initialize audio output devices and delays from saved settings
 * Called once when audio first plays
 */
async function initializeAudioDevices(): Promise<void> {
  if (audioDevicesInitialized) {
    return;
  }
  audioDevicesInitialized = true;

  const router = getOutputRouter();
  if (!router) {
    // Reset flag on early return so we can retry later
    audioDevicesInitialized = false;
    return;
  }

  await applyCurrentAudioSettings();
}

const getSoundId = (radio: Radio, side: DeckSide): string =>
  `${side}_${radio.id}`;

// Deck-specific function mappings
const deckConfig: Record<
  DeckId,
  {
    side: DeckSide;
    getDeck: typeof getDeckA;
    getRuntime: typeof getDeckARuntime;
    getSubscriptionCleanup: typeof getDeckASubscriptionCleanup;
    setSubscriptionCleanup: typeof setDeckASubscriptionCleanup;
    setSoundId: typeof setDeckASoundId;
    setRuntimeState: typeof setDeckARuntimeState;
    resetRuntime: typeof resetDeckARuntime;
    updateDeck: typeof updateDeckA;
  }
> = {
  "deck-a": {
    side: "left",
    getDeck: getDeckA,
    getRuntime: getDeckARuntime,
    getSubscriptionCleanup: getDeckASubscriptionCleanup,
    setSubscriptionCleanup: setDeckASubscriptionCleanup,
    setSoundId: setDeckASoundId,
    setRuntimeState: setDeckARuntimeState,
    resetRuntime: resetDeckARuntime,
    updateDeck: updateDeckA,
  },
  "deck-b": {
    side: "right",
    getDeck: getDeckB,
    getRuntime: getDeckBRuntime,
    getSubscriptionCleanup: getDeckBSubscriptionCleanup,
    setSubscriptionCleanup: setDeckBSubscriptionCleanup,
    setSoundId: setDeckBSoundId,
    setRuntimeState: setDeckBRuntimeState,
    resetRuntime: resetDeckBRuntime,
    updateDeck: updateDeckB,
  },
};

/**
 * Handle track end - repeat current track or auto-advance to next in playlist/album.
 */
function handleTrackEnded(
  config: (typeof deckConfig)["deck-a"],
  currentDeck: DeckRecord,
  soundId: string
): void {
  // Repeat mode: seek to start and replay
  if (currentDeck.repeat) {
    getAudioManager().seekSound(soundId, 0);
    getAudioManager()
      .playSound(soundId, currentDeck.volume)
      .then(() => applyCrossfade())
      .catch(() => setDjError("Failed to repeat track"));
    return;
  }

  // Auto-advance to next track (only if autoplay is enabled)
  if (!currentDeck.autoplay) {
    return;
  }

  const deckRadio = getDeckRadio(currentDeck);
  const nextTrack = findNextTrack(deckRadio);
  if (nextTrack && deckRadio) {
    // Resolve YouTube yt:{videoId} URLs before loading
    const streamUrl = nextTrack.streamUrl;
    if (streamUrl.startsWith("yt:")) {
      const videoId = streamUrl.slice(3);
      resolveStreamUrl(videoId)
        .then((resolvedUrl) => {
          if (resolvedUrl) {
            // Update the track's streamUrl in metadata for tracklist highlighting
            if (
              isYouTubeMetadata(deckRadio.platformMetadata) &&
              deckRadio.platformMetadata.tracks
            ) {
              const track = deckRadio.platformMetadata.tracks.find(
                (t) => "videoId" in t && t.videoId === videoId
              );
              if (track) {
                track.streamUrl = resolvedUrl;
              }
            }
            loadTrack(
              config.side,
              { ...deckRadio, streamUrl: resolvedUrl },
              true
            );
          } else {
            setDjError("Failed to resolve next track");
          }
        })
        .catch(() => setDjError("Failed to load next track"));
    } else {
      loadTrack(
        config.side,
        { ...deckRadio, streamUrl },
        true // auto-play
      );
    }
  }
}

/**
 * Handle YouTube stream interruption by fetching a fresh URL and resuming playback.
 * Called when STREAM_INTERRUPTED error is received for a YouTube stream.
 */
function handleYouTubeStreamInterrupted(
  soundId: string,
  videoId: string,
  position: number
): void {
  console.log(
    `[dj-actions] YouTube stream interrupted at ${position}s, attempting refresh`
  );

  refreshYouTubeStreamUrl(videoId).then((newUrl) => {
    if (newUrl) {
      getAudioManager()
        .refreshStreamUrl(soundId, newUrl, position)
        .then(() => {
          setDjError(null); // Clear error on successful refresh
          applyCrossfade();
        })
        .catch((err) => {
          setDjError(
            `Stream refresh failed: ${err instanceof Error ? err.message : "Unknown error"}`
          );
        });
    } else {
      setDjError("Failed to refresh YouTube stream - please reload");
    }
  });
}

/**
 * Refresh a YouTube stream URL when interrupted.
 * Uses Piped API which handles n-param transformation server-side.
 * Returns the proxied URL or null on failure.
 */
async function refreshYouTubeStreamUrl(
  videoId: string
): Promise<string | null> {
  try {
    const streamUrl = await resolveStreamUrl(videoId);
    if (streamUrl) {
      return streamUrl;
    }
    return null;
  } catch {
    return null;
  }
}

// Helper to get stream URL for a track (handles YouTube lazy resolution format)
function getTrackStreamUrl(
  track: { streamUrl: string; videoId?: string },
  platform: string
): string {
  if (track.streamUrl) {
    return track.streamUrl;
  }
  // YouTube tracks use yt:{videoId} format for lazy resolution
  if (platform === "youtube" && "videoId" in track && track.videoId) {
    return `yt:${track.videoId}`;
  }
  return "";
}

// Helper to find current track index in a playlist
function findCurrentTrackIndex(
  tracks: Array<{ streamUrl: string; videoId?: string }>,
  currentStreamUrl: string,
  platform: string
): number {
  // First try direct streamUrl match
  let index = tracks.findIndex((t) => t.streamUrl === currentStreamUrl);
  if (index !== -1) {
    return index;
  }

  // For YouTube, also check by videoId since streamUrl might be yt:{id}
  if (platform === "youtube" && currentStreamUrl.startsWith("yt:")) {
    const currentVideoId = currentStreamUrl.slice(3);
    index = tracks.findIndex(
      (t) => "videoId" in t && t.videoId === currentVideoId
    );
  }

  return index;
}

// Helper to find next track in a platform playlist/album
export const findNextTrack = (
  radio: Radio | null
): { streamUrl: string } | null => {
  if (
    !radio?.platformMetadata ||
    radio.platformMetadata.platform === "device-input" ||
    radio.platformMetadata.platform === "local-file"
  ) {
    return null;
  }

  const { platformMetadata } = radio;

  if (!("tracks" in platformMetadata && platformMetadata.tracks)) {
    return null;
  }

  const { tracks, platform, itemType } = platformMetadata;

  // Only handle collections (albums/playlists)
  const isCollection =
    (platform === "bandcamp" && itemType === "album") ||
    (platform === "soundcloud" && itemType === "playlist") ||
    (platform === "youtube" && itemType === "playlist");

  if (!isCollection || tracks.length === 0) {
    return null;
  }

  const currentIndex = findCurrentTrackIndex(tracks, radio.streamUrl, platform);

  // Current track not found, return first track
  if (currentIndex === -1) {
    const firstTrack = tracks[0];
    if (!firstTrack) {
      return null;
    }
    const streamUrl = getTrackStreamUrl(firstTrack, platform);
    return streamUrl ? { streamUrl } : null;
  }

  // Return next track if available
  const nextIndex = currentIndex + 1;
  if (nextIndex < tracks.length) {
    const nextTrack = tracks[nextIndex];
    if (!nextTrack) {
      return null;
    }
    const streamUrl = getTrackStreamUrl(nextTrack, platform);
    return streamUrl ? { streamUrl } : null;
  }

  // No more tracks
  return null;
};

// Apply stored effects and filters to a newly loaded sound
function applyStoredEffectsAndFilters(
  soundId: string,
  effects: EffectConfig[],
  filter: FilterConfig
) {
  try {
    // Apply stored filter if enabled
    if (filter.enabled) {
      getAudioManager().updateFilter(soundId, filter);
    }

    // Apply stored effects
    for (const effect of effects) {
      getAudioManager().addEffect(soundId, effect);
    }
  } catch {
    // Non-critical: effects will be missing but audio still plays
  }
}

// Apply stored channel strip settings to a newly loaded sound
function applyStoredChannelStrip(
  soundId: string,
  muted: boolean,
  pan: number,
  speed: number,
  channelFilter: number,
  effectsDryWet: number
) {
  try {
    const manager = getAudioManager();

    if (muted) {
      manager.muteSound(soundId);
    }
    if (pan !== 0) {
      manager.setPan(soundId, pan);
    }
    if (speed !== 1) {
      manager.setPlaybackRate(soundId, speed);
    }
    if (channelFilter !== 0) {
      manager.setChannelFilter(soundId, channelFilter);
    }
    if (effectsDryWet !== 1) {
      manager.setEffectsDryWet(soundId, effectsDryWet);
    }
  } catch {
    // Non-critical: channel strip defaults will be used
  }
}

/**
 * Connect a deck's pre-fader audio node to the CueBus for CUE monitoring
 * This should be called after audio starts playing
 */
function connectDeckToCueBus(deckId: DeckId, soundId: string): void {
  const bus = ensureCueBus();
  if (!bus) {
    return;
  }

  const manager = getAudioManager();

  // Connect pre-fader for CUE monitoring (raw audio, unaffected by crossfader)
  const preFaderNode = manager.getPreFaderNode(soundId);
  if (preFaderNode) {
    bus.connectPreFader(deckId, preFaderNode);
  }

  // Restore CUE enabled state from mixer
  const mixer = getMixer();
  if (mixer) {
    const enabled =
      deckId === "deck-a" ? mixer.deckACueEnabled : mixer.deckBCueEnabled;
    if (enabled) {
      bus.setCueEnabled(deckId, true);
    }
  }
}

// Apply crossfade based on current mixer position
export function applyCrossfade() {
  if (typeof window === "undefined") {
    return;
  }

  const deckA = getDeckA();
  const deckB = getDeckB();
  const mixer = getMixer();
  const runtimeA = getDeckARuntime();
  const runtimeB = getDeckBRuntime();

  if (!(deckA && deckB && mixer)) {
    return;
  }

  const { crossfadePosition } = mixer;

  const leftFinalVol = (1 - crossfadePosition) * deckA.volume;
  const rightFinalVol = crossfadePosition * deckB.volume;

  const manager = getAudioManager();
  if (runtimeA.soundId) {
    manager.setVolume(runtimeA.soundId, leftFinalVol);
  }
  if (runtimeB.soundId) {
    manager.setVolume(runtimeB.soundId, rightFinalVol);
  }
}

// Generic set deck radio function
async function setDeckRadio(deckId: DeckId, radio: Radio | null) {
  const config = deckConfig[deckId];
  const deck = config.getDeck();
  const runtime = config.getRuntime();

  if (!deck) {
    return;
  }

  // Preserve the playing state before cleanup
  const wasPlaying = runtime.isPlaying;

  // Unsubscribe from previous subscription
  const prevCleanup = config.getSubscriptionCleanup();
  if (prevCleanup) {
    prevCleanup();
    config.setSubscriptionCleanup(null);
  }

  // Revoke object URL if previous source was a local file
  const prevRadio = getDeckRadio(deck);
  if (prevRadio && isFileMetadata(prevRadio.platformMetadata)) {
    revokeFileObjectUrl(prevRadio.platformMetadata.objectUrl);
  }

  // Cleanup existing sound (CueBus handles disconnect internally via connectPreFader)
  if (runtime.soundId) {
    await getAudioManager().cleanupSound(runtime.soundId);
  }

  if (!radio) {
    // Reset both DB state and runtime state
    resetDeckDb(deckId);
    config.resetRuntime();
    return;
  }

  const soundId = getSoundId(radio, config.side);

  try {
    setDjError(null);

    // Create the sound
    getAudioManager().createSound(radio, soundId);

    // Update DB with radio
    config.updateDeck((draft) => {
      draft.radio = radio;
    });

    // Update runtime with soundId
    config.setSoundId(soundId);

    // Track whether we've applied channel strip settings
    let hasAppliedChannelStrip = false;

    // Subscribe to sound events
    const cleanup = getAudioManager().subscribe(soundId, (audioState) => {
      const currentDeck = config.getDeck();
      const currentRuntime = config.getRuntime();

      // Apply stored settings on first play and connect to CueBus
      if (
        audioState.isPlaying &&
        !audioState.isLoading &&
        !hasAppliedChannelStrip &&
        currentDeck
      ) {
        hasAppliedChannelStrip = true;
        applyStoredEffectsAndFilters(
          soundId,
          getDeckEffects(currentDeck),
          currentDeck.filter
        );
        applyStoredChannelStrip(
          soundId,
          currentDeck.muted,
          currentDeck.pan,
          currentDeck.speed,
          currentDeck.channelFilter,
          currentDeck.effectsDryWet
        );

        // Connect to CueBus for pre-fader monitoring
        connectDeckToCueBus(deckId, soundId);

        // Initialize audio output devices from saved settings
        initializeAudioDevices().catch(() => {
          // Non-critical: will use default audio output
        });
      }

      // Detect track end
      const trackEnded = audioState.hasEnded;

      // Update runtime state if changed
      if (
        currentRuntime.isPlaying !== audioState.isPlaying ||
        currentRuntime.isLoading !== audioState.isLoading ||
        currentRuntime.isBuffering !== audioState.isBuffering
      ) {
        config.setRuntimeState(() => ({
          isPlaying: audioState.isPlaying,
          isLoading: audioState.isLoading,
          isBuffering: audioState.isBuffering,
        }));
      }

      // Handle STREAM_INTERRUPTED error for YouTube streams (auto-refresh on 403)
      if (
        audioState.error?.code === "STREAM_INTERRUPTED" &&
        currentDeck?.radio &&
        isYouTubeMetadata(currentDeck.radio.platformMetadata) &&
        currentDeck.radio.platformMetadata.videoId &&
        currentRuntime.soundId
      ) {
        handleYouTubeStreamInterrupted(
          currentRuntime.soundId,
          currentDeck.radio.platformMetadata.videoId,
          audioState.error.position ?? 0
        );
        return; // Don't set error - wait for refresh attempt
      }

      // Set error if present (skip STREAM_INTERRUPTED - handled above)
      if (audioState.error?.message) {
        setDjError(audioState.error.message);
      }

      // Handle track end - repeat or auto-advance to next track
      if (trackEnded && currentDeck?.radio && currentRuntime.soundId) {
        handleTrackEnded(config, currentDeck, currentRuntime.soundId);
      }
    });

    config.setSubscriptionCleanup(cleanup);

    // If the previous radio was playing, auto-play the new one
    if (wasPlaying) {
      await getAudioManager().playSound(soundId, deck.volume);
      applyCrossfade();
    }
  } catch (err) {
    // Cleanup partial state on error
    const currentRuntime = config.getRuntime();
    if (currentRuntime.soundId === soundId) {
      const existingCleanup = config.getSubscriptionCleanup();
      if (existingCleanup) {
        existingCleanup();
        config.setSubscriptionCleanup(null);
      }
      try {
        getAudioManager().cleanupSound(soundId);
      } catch {
        // Cleanup failure during error recovery - nothing more to do
      }
      config.resetRuntime();
    }
    const msg = err instanceof Error ? err.message : `Failed to load ${deckId}`;
    setDjError(msg);
  }
}

// Public deck radio functions
export async function setDeckARadio(radio: Radio | null) {
  return await setDeckRadio("deck-a", radio);
}

export async function setDeckBRadio(radio: Radio | null) {
  return await setDeckRadio("deck-b", radio);
}

// Generic play deck function
async function playDeck(deckId: DeckId) {
  const config = deckConfig[deckId];
  const deck = config.getDeck();
  const runtime = config.getRuntime();

  if (runtime.soundId && deck?.radio && !runtime.isPlaying) {
    try {
      await getAudioManager().playSound(runtime.soundId, deck.volume);
      applyCrossfade();
    } catch (err) {
      setDjError(
        err instanceof Error ? err.message : `Failed to play ${deckId}`
      );
    }
  }
}

export async function playDeckA() {
  return await playDeck("deck-a");
}

export async function playDeckB() {
  return await playDeck("deck-b");
}

// Generic pause deck function
function pauseDeck(deckId: DeckId) {
  const runtime = deckConfig[deckId].getRuntime();
  if (runtime.soundId) {
    getAudioManager().pauseSound(runtime.soundId);
  }
}

export function pauseDeckA() {
  pauseDeck("deck-a");
}

export function pauseDeckB() {
  pauseDeck("deck-b");
}

// Generic reset deck function
async function resetDeck(deckId: DeckId) {
  const config = deckConfig[deckId];
  const deck = config.getDeck();
  if (deck?.radio) {
    // Reset channel strip to defaults
    config.updateDeck((draft) => {
      draft.volume = 1;
      draft.muted = false;
      draft.pan = 0;
      draft.speed = 1.0;
      draft.channelFilter = 0;
      draft.effectsDryWet = 1.0;
      draft.effects = [];
      draft.filter = {
        type: "lowpass",
        frequency: 1000,
        Q: 1,
        gain: 0,
        enabled: false,
      };
    });
    const radio = getDeckRadio(deck);
    await setDeckRadio(deckId, radio);
  }
}

export async function resetDeckA() {
  return await resetDeck("deck-a");
}

export async function resetDeckB() {
  return await resetDeck("deck-b");
}

// Cleanup all decks
export async function cleanupAll() {
  await Promise.all([setDeckARadio(null), setDeckBRadio(null)]);
}

// Cleanup audio only (keep radio state)
export async function cleanupAudioOnly() {
  const runtimeA = getDeckARuntime();
  const runtimeB = getDeckBRuntime();

  // Cleanup subscriptions
  const cleanupA = getDeckASubscriptionCleanup();
  const cleanupB = getDeckBSubscriptionCleanup();
  if (cleanupA) {
    cleanupA();
  }
  if (cleanupB) {
    cleanupB();
  }

  // Cleanup sounds
  if (runtimeA.soundId) {
    await getAudioManager().cleanupSound(runtimeA.soundId);
  }
  if (runtimeB.soundId) {
    await getAudioManager().cleanupSound(runtimeB.soundId);
  }

  // Reset runtime state only
  resetDeckARuntime();
  resetDeckBRuntime();
  setDjError(null);
}

// Unified track loading
export async function loadTrack(
  deckSide: DeckSide,
  radio: Radio | null,
  autoPlay = false
) {
  const deckId = deckSide === "left" ? "deck-a" : "deck-b";
  const config = deckConfig[deckId];
  const runtime = config.getRuntime();
  const setRadio = deckSide === "left" ? setDeckARadio : setDeckBRadio;
  const pause = deckSide === "left" ? pauseDeckA : pauseDeckB;
  const play = deckSide === "left" ? playDeckA : playDeckB;

  // Handle clearing the deck
  if (!radio) {
    await setRadio(null);
    return;
  }

  // Prevent re-entry if already loading
  if (runtime.isLoading) {
    return;
  }

  // Pause current track if playing
  if (runtime.isPlaying) {
    pause();
  }

  // Load new track
  await setRadio(radio);

  // Auto-play if requested
  if (autoPlay) {
    await play();
  }
}

// Mixer actions
export function setCrossfadePosition(position: number) {
  updateMixer((draft) => {
    draft.crossfadePosition = position;
  });
  applyCrossfade();
}

export function setMasterVolume(volume: number) {
  updateMixer((draft) => {
    draft.masterVolume = volume;
  });
  getAudioManager().setGlobalVolume(volume);
}

// Volume actions with audio manager sync
function setDeckVolume(deckId: DeckId, volume: number) {
  deckConfig[deckId].updateDeck((draft) => {
    draft.volume = volume;
  });
  applyCrossfade();
}

export function setDeckAVolume(volume: number) {
  setDeckVolume("deck-a", volume);
}

export function setDeckBVolume(volume: number) {
  setDeckVolume("deck-b", volume);
}

// Mute actions with audio manager sync
function setDeckMute(deckId: DeckId, muted: boolean) {
  const runtime = deckConfig[deckId].getRuntime();
  deckConfig[deckId].updateDeck((draft) => {
    draft.muted = muted;
  });
  if (runtime.soundId) {
    if (muted) {
      getAudioManager().muteSound(runtime.soundId);
    } else {
      getAudioManager().unmuteSound(runtime.soundId);
    }
  }
}

export function setDeckAMute(muted: boolean) {
  setDeckMute("deck-a", muted);
}

export function setDeckBMute(muted: boolean) {
  setDeckMute("deck-b", muted);
}

// Channel strip actions with audio manager sync
function setDeckPan(deckId: DeckId, pan: number) {
  const runtime = deckConfig[deckId].getRuntime();
  deckConfig[deckId].updateDeck((draft) => {
    draft.pan = pan;
  });
  if (runtime.soundId) {
    getAudioManager().setPan(runtime.soundId, pan);
  }
}

export function setDeckAPan(pan: number) {
  setDeckPan("deck-a", pan);
}

export function setDeckBPan(pan: number) {
  setDeckPan("deck-b", pan);
}

function setDeckSpeed(deckId: DeckId, speed: number) {
  const runtime = deckConfig[deckId].getRuntime();
  deckConfig[deckId].updateDeck((draft) => {
    draft.speed = speed;
  });
  if (runtime.soundId) {
    getAudioManager().setPlaybackRate(runtime.soundId, speed);
  }
}

export function setDeckASpeed(speed: number) {
  setDeckSpeed("deck-a", speed);
}

export function setDeckBSpeed(speed: number) {
  setDeckSpeed("deck-b", speed);
}

function setDeckRepeat(deckId: DeckId, enabled: boolean) {
  deckConfig[deckId].updateDeck((draft) => {
    draft.repeat = enabled;
  });
}

export function setDeckARepeat(enabled: boolean) {
  setDeckRepeat("deck-a", enabled);
}

export function setDeckBRepeat(enabled: boolean) {
  setDeckRepeat("deck-b", enabled);
}

function setDeckAutoplay(deckId: DeckId, enabled: boolean) {
  deckConfig[deckId].updateDeck((draft) => {
    draft.autoplay = enabled;
  });
}

export function setDeckAAutoplay(enabled: boolean) {
  setDeckAutoplay("deck-a", enabled);
}

export function setDeckBAutoplay(enabled: boolean) {
  setDeckAutoplay("deck-b", enabled);
}

function seekDeck(deckId: DeckId, position: number) {
  const runtime = deckConfig[deckId].getRuntime();
  if (runtime.soundId) {
    getAudioManager().seekSound(runtime.soundId, position);
  }
}

export function seekDeckA(position: number) {
  seekDeck("deck-a", position);
}

export function seekDeckB(position: number) {
  seekDeck("deck-b", position);
}

function setDeckChannelFilter(deckId: DeckId, value: number) {
  const runtime = deckConfig[deckId].getRuntime();
  deckConfig[deckId].updateDeck((draft) => {
    draft.channelFilter = value;
  });
  if (runtime.soundId) {
    getAudioManager().setChannelFilter(runtime.soundId, value);
  }
}

export function setDeckAChannelFilter(value: number) {
  setDeckChannelFilter("deck-a", value);
}

export function setDeckBChannelFilter(value: number) {
  setDeckChannelFilter("deck-b", value);
}

function setDeckEffectsDryWet(deckId: DeckId, value: number) {
  const runtime = deckConfig[deckId].getRuntime();
  deckConfig[deckId].updateDeck((draft) => {
    draft.effectsDryWet = value;
  });
  if (runtime.soundId) {
    getAudioManager().setEffectsDryWet(runtime.soundId, value);
  }
}

export function setDeckAEffectsDryWet(value: number) {
  setDeckEffectsDryWet("deck-a", value);
}

export function setDeckBEffectsDryWet(value: number) {
  setDeckEffectsDryWet("deck-b", value);
}

// Filter actions with audio manager sync
function updateDeckFilter(deckId: DeckId, filter: FilterConfig) {
  const runtime = deckConfig[deckId].getRuntime();
  deckConfig[deckId].updateDeck((draft) => {
    draft.filter = filter;
  });
  if (runtime.soundId) {
    getAudioManager().updateFilter(runtime.soundId, filter);
  }
}

export function updateDeckAFilter(filter: FilterConfig) {
  updateDeckFilter("deck-a", filter);
}

export function updateDeckBFilter(filter: FilterConfig) {
  updateDeckFilter("deck-b", filter);
}

// Effect actions with audio manager sync
function addDeckEffect(deckId: DeckId, type: EffectType) {
  const config = deckConfig[deckId];
  const runtime = config.getRuntime();
  const deck = config.getDeck();
  const effects = deck?.effects ?? [];
  const effect = createDefaultEffectConfig(
    type,
    crypto.randomUUID(),
    effects.length
  );
  config.updateDeck((draft) => {
    // @ts-expect-error -- EffectConfig is compatible with Zod-inferred effect schema at runtime
    draft.effects.push(effect);
  });
  if (runtime.soundId) {
    getAudioManager().addEffect(runtime.soundId, effect);
  }
}

export function addDeckAEffect(type: EffectType) {
  addDeckEffect("deck-a", type);
}

export function addDeckBEffect(type: EffectType) {
  addDeckEffect("deck-b", type);
}

function updateDeckEffect(
  deckId: DeckId,
  effectId: string,
  effectConfig: Partial<EffectConfig>
) {
  const config = deckConfig[deckId];
  const runtime = config.getRuntime();
  config.updateDeck((draft) => {
    const idx = draft.effects.findIndex((e) => e.id === effectId);
    if (idx !== -1) {
      const effect = draft.effects[idx];
      if (effect) {
        draft.effects[idx] = { ...effect, ...effectConfig };
      }
    }
  });
  if (runtime.soundId) {
    getAudioManager().updateEffect(runtime.soundId, effectId, effectConfig);
  }
}

export function updateDeckAEffect(
  effectId: string,
  config: Partial<EffectConfig>
) {
  updateDeckEffect("deck-a", effectId, config);
}

export function updateDeckBEffect(
  effectId: string,
  config: Partial<EffectConfig>
) {
  updateDeckEffect("deck-b", effectId, config);
}

function removeDeckEffect(deckId: DeckId, effectId: string) {
  const config = deckConfig[deckId];
  const runtime = config.getRuntime();
  config.updateDeck((draft) => {
    draft.effects = draft.effects.filter((e) => e.id !== effectId);
  });
  if (runtime.soundId) {
    getAudioManager().removeEffect(runtime.soundId, effectId);
  }
}

export function removeDeckAEffect(effectId: string) {
  removeDeckEffect("deck-a", effectId);
}

export function removeDeckBEffect(effectId: string) {
  removeDeckEffect("deck-b", effectId);
}

function reorderDeckEffects(deckId: DeckId, effectIds: string[]) {
  const config = deckConfig[deckId];
  const runtime = config.getRuntime();
  const deck = config.getDeck();
  if (!deck) {
    return;
  }
  const reorderedEffects = effectIds
    .map((id) => deck.effects.find((e) => e.id === id))
    .filter((e) => e !== undefined);
  config.updateDeck((draft) => {
    draft.effects = reorderedEffects;
  });
  if (runtime.soundId) {
    getAudioManager().reorderEffects(runtime.soundId, effectIds);
  }
}

export function reorderDeckAEffects(effectIds: string[]) {
  reorderDeckEffects("deck-a", effectIds);
}

export function reorderDeckBEffects(effectIds: string[]) {
  reorderDeckEffects("deck-b", effectIds);
}

// ============================================
// CUE Monitoring Actions
// ============================================

/**
 * Ensure CueBus is initialized, creating it if necessary
 * Returns the CueBus instance or null if AudioContext isn't available yet
 */
function ensureCueBus(): CueBus | null {
  if (cueBus) {
    return cueBus;
  }

  // Try to get AudioContext (requires user gesture to have happened)
  const context = getAudioContext();
  if (!context) {
    // AudioContext not yet available - will be initialized on first play
    return null;
  }

  // Initialize CueBus
  return getCueBus(context);
}

/**
 * Enable/disable CUE monitoring for a deck (pre-fader listen)
 */
function setDeckCueEnabled(deckId: DeckId, enabled: boolean) {
  const bus = ensureCueBus();
  if (bus) {
    bus.setCueEnabled(deckId, enabled);
  }
  // Always update mixer state so it persists
  updateMixer((draft) => {
    if (deckId === "deck-a") {
      draft.deckACueEnabled = enabled;
    } else {
      draft.deckBCueEnabled = enabled;
    }
  });
}

export function setDeckACueEnabled(enabled: boolean) {
  setDeckCueEnabled("deck-a", enabled);
}

export function setDeckBCueEnabled(enabled: boolean) {
  setDeckCueEnabled("deck-b", enabled);
}

/**
 * Toggle CUE monitoring for a deck
 */
export function toggleDeckACue() {
  if (!getAudioSettings().cueOutputId) {
    return;
  }
  const mixer = getMixer();
  if (!mixer) {
    return;
  }
  setDeckACueEnabled(!mixer.deckACueEnabled);
}

export function toggleDeckBCue() {
  if (!getAudioSettings().cueOutputId) {
    return;
  }
  const mixer = getMixer();
  if (!mixer) {
    return;
  }
  setDeckBCueEnabled(!mixer.deckBCueEnabled);
}

/**
 * Set headphone volume (0-1)
 * Independent volume control for CUE headphone output
 */
export function setHeadphoneVolume(volume: number) {
  const bus = ensureCueBus();
  updateMixer((draft) => {
    draft.headphoneVolume = volume;
  });
  if (bus) {
    bus.setHeadphoneVolume(volume);
  }
}

/**
 * Cleanup CueBus resources
 */
export function cleanupCueBus() {
  if (cueBus) {
    cueBus.cleanup();
    cueBus = null;
  }
}

// ============================================
// Output Delay Actions
// ============================================

/**
 * Set main output delay (0-500ms)
 * Applies delay to all audio going to the main speakers
 */
export function setMainOutputDelay(ms: number) {
  // Persist to settings
  setMainDelayMsSetting(ms);

  // Apply to AudioManager
  getAudioManager().setMainDelay(ms);
}

/**
 * Set CUE output delay (0-500ms)
 * Applies delay to headphone/CUE output for timing adjustment
 */
export function setCueOutputDelay(ms: number) {
  // Persist to settings
  setCueDelayMsSetting(ms);

  // Apply to CueBus
  const bus = ensureCueBus();
  if (bus) {
    bus.setCueDelay(ms);
  }
}

/**
 * Get current delay settings
 */
export function getOutputDelays(): { mainDelayMs: number; cueDelayMs: number } {
  return getDelaySettings();
}

/**
 * Initialize output delays from saved settings
 * Called when audio system is ready
 */
export function initializeOutputDelays(): void {
  const { mainDelayMs, cueDelayMs } = getDelaySettings();

  if (mainDelayMs > 0) {
    getAudioManager().setMainDelay(mainDelayMs);
  }

  if (cueDelayMs > 0) {
    const bus = ensureCueBus();
    if (bus) {
      bus.setCueDelay(cueDelayMs);
    }
  }
}

/**
 * Detect system audio output latency
 * Uses AudioContext.outputLatency and baseLatency to estimate total latency
 * Returns latency in milliseconds, or null if not available
 */
export function detectSystemLatency(): number | null {
  const context = getAudioContext();
  if (!context) {
    return null;
  }

  // outputLatency: time from audio graph to speaker (device-specific)
  // baseLatency: processing latency of the audio context
  const outputLatency = context.outputLatency ?? 0;
  const baseLatency = context.baseLatency ?? 0;

  const totalLatencySeconds = outputLatency + baseLatency;

  // Convert to milliseconds and round
  const totalLatencyMs = Math.round(totalLatencySeconds * 1000);

  // Return null if latency is 0 (browser doesn't support or hasn't measured yet)
  if (totalLatencyMs === 0) {
    return null;
  }

  return totalLatencyMs;
}

/**
 * Auto-detect and apply system latency to main output delay
 * Returns the detected latency in ms, or null if detection failed
 */
export function autoCompensateLatency(): number | null {
  const latencyMs = detectSystemLatency();

  if (latencyMs === null) {
    return null;
  }

  // Apply to main output delay
  setMainOutputDelay(latencyMs);

  return latencyMs;
}

// ============================================
// Device Input Source Actions
// ============================================

/**
 * Set a deck to use device input (mic/line-in), routed through AudioManager's full graph
 */
async function setDeckDeviceSource(
  deckId: DeckId,
  deviceId: string,
  deviceLabel: string
): Promise<void> {
  const config = deckConfig[deckId];
  const deck = config.getDeck();
  const runtime = config.getRuntime();

  if (!deck) {
    return;
  }

  // Unsubscribe from previous subscription
  const prevCleanup = config.getSubscriptionCleanup();
  if (prevCleanup) {
    prevCleanup();
    config.setSubscriptionCleanup(null);
  }

  // Cleanup existing sound
  if (runtime.soundId) {
    getAudioManager().cleanupSound(runtime.soundId);
  }

  const side = config.side;
  const radioId = `device-input-${side}`;
  const soundId = `${side}_${radioId}`;

  const platformMetadata: DeviceInputMetadata = {
    platform: "device-input",
    itemType: "track",
    url: "",
    deviceId,
    deviceLabel,
    channelSelection: { left: 0, right: 1 },
    channelCount: 2,
  };

  const radio: Radio = {
    id: radioId,
    name: deviceLabel,
    streamUrl: "",
    description: "Device input (mic/line-in)",
    enabled: true,
    platformMetadata,
  };

  try {
    setDjError(null);

    // Create the sound in AudioManager
    getAudioManager().createSound(radio, soundId);

    // Update DB with radio
    config.updateDeck((draft) => {
      draft.radio = radio;
    });

    // Update runtime with soundId
    config.setSoundId(soundId);

    // Track whether we've applied channel strip settings
    let hasAppliedChannelStrip = false;

    // Subscribe to sound events
    const cleanup = getAudioManager().subscribe(soundId, (audioState) => {
      const currentDeck = config.getDeck();
      const currentRuntime = config.getRuntime();

      // Apply stored settings on first play and connect to CueBus
      if (
        audioState.isPlaying &&
        !audioState.isLoading &&
        !hasAppliedChannelStrip &&
        currentDeck
      ) {
        hasAppliedChannelStrip = true;
        applyStoredEffectsAndFilters(
          soundId,
          getDeckEffects(currentDeck),
          currentDeck.filter
        );
        applyStoredChannelStrip(
          soundId,
          currentDeck.muted,
          currentDeck.pan,
          currentDeck.speed,
          currentDeck.channelFilter,
          currentDeck.effectsDryWet
        );

        // Connect to CueBus for pre-fader monitoring
        connectDeckToCueBus(deckId, soundId);

        // Initialize audio output devices from saved settings
        initializeAudioDevices().catch(() => {
          // Non-critical: will use default audio output
        });
      }

      // Update runtime state if changed
      if (
        currentRuntime.isPlaying !== audioState.isPlaying ||
        currentRuntime.isLoading !== audioState.isLoading ||
        currentRuntime.isBuffering !== audioState.isBuffering
      ) {
        config.setRuntimeState(() => ({
          isPlaying: audioState.isPlaying,
          isLoading: audioState.isLoading,
          isBuffering: audioState.isBuffering,
        }));
      }

      // Set error if present
      if (audioState.error?.message) {
        setDjError(audioState.error.message);
      }
    });

    config.setSubscriptionCleanup(cleanup);

    // Play via AudioManager's device sound path
    await getAudioManager().playDeviceSound(soundId, deviceId);

    // Read actual channel count from the opened device and update metadata
    const deviceSource = getAudioManager().getDeviceSource(soundId);
    if (deviceSource) {
      const actualChannelCount = deviceSource.channelCount;
      config.updateDeck((draft) => {
        const meta = draft.radio?.platformMetadata;
        if (isDeviceInputMetadata(meta)) {
          meta.channelCount = actualChannelCount;
        }
      });
    }

    applyCrossfade();
  } catch (err) {
    // Cleanup partial state on error
    const currentRuntime = config.getRuntime();
    if (currentRuntime.soundId === soundId) {
      const existingCleanup = config.getSubscriptionCleanup();
      if (existingCleanup) {
        existingCleanup();
        config.setSubscriptionCleanup(null);
      }
      try {
        getAudioManager().cleanupSound(soundId);
      } catch {
        // Cleanup failure during error recovery - nothing more to do
      }
      config.resetRuntime();
    }
    const msg =
      err instanceof Error ? err.message : "Failed to start device input";
    setDjError(msg);
  }
}

export function setDeckADeviceSource(
  deviceId: string,
  deviceLabel: string
): Promise<void> {
  return setDeckDeviceSource("deck-a", deviceId, deviceLabel);
}

export function setDeckBDeviceSource(
  deviceId: string,
  deviceLabel: string
): Promise<void> {
  return setDeckDeviceSource("deck-b", deviceId, deviceLabel);
}

// Channel selection actions
function setDeckChannelSelection(
  deckId: DeckId,
  selection: ChannelSelection
): void {
  const runtime = deckConfig[deckId].getRuntime();
  if (runtime.soundId) {
    getAudioManager().setDeviceChannelSelection(runtime.soundId, selection);
  }
  deckConfig[deckId].updateDeck((draft) => {
    const meta = draft.radio?.platformMetadata;
    if (isDeviceInputMetadata(meta)) {
      meta.channelSelection = selection;
    }
  });
}

export function setDeckAChannelSelection(selection: ChannelSelection): void {
  setDeckChannelSelection("deck-a", selection);
}

export function setDeckBChannelSelection(selection: ChannelSelection): void {
  setDeckChannelSelection("deck-b", selection);
}

// ============================================
// Local File Source Actions
// ============================================

/**
 * Load a local audio file into a deck.
 * Creates an object URL and feeds it to Html5AudioSource via setDeckRadio.
 */
async function setDeckFileSource(deckId: DeckId, file: File): Promise<void> {
  const config = deckConfig[deckId];
  const side = config.side;

  try {
    setDjError(null);
    const meta = await extractFileMetadata(file);

    const platformMetadata: FileMetadata = {
      platform: "local-file",
      itemType: "track",
      url: "",
      fileName: meta.fileName,
      displayName: meta.displayName,
      duration: meta.duration,
      fileSize: meta.fileSize,
      mimeType: meta.mimeType,
      objectUrl: meta.objectUrl,
    };

    const radio: Radio = {
      id: `local-file-${side}-${Date.now()}`,
      name: meta.displayName,
      streamUrl: meta.objectUrl,
      description: "Local File",
      enabled: true,
      platformMetadata,
    };

    await setDeckRadio(deckId, radio);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Failed to load audio file";
    setDjError(msg);
  }
}

export function setDeckAFileSource(file: File): Promise<void> {
  return setDeckFileSource("deck-a", file);
}

export function setDeckBFileSource(file: File): Promise<void> {
  return setDeckFileSource("deck-b", file);
}
