/**
 * useDjAudio Hook
 *
 * Dual deck audio hook for DJ-style mixing with crossfader,
 * per-deck effects, and filter controls.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createDefaultEffectConfig } from "../dsp/effects/registry.js";
import type { EffectConfig } from "../dsp/effects/types.js";
import { AudioManager, type FilterConfig } from "../manager/audio-manager.js";
import type { AudioState, Radio } from "../playback/types.js";

const CROSSFADE_POSITION = 0.5;

export function useDjAudio() {
  const audioManager = AudioManager.getInstance();

  const [leftRadio, setLeftRadioState] = useState<Radio | null>(null);
  const [rightRadio, setRightRadioState] = useState<Radio | null>(null);
  const [crossfadePosition, setCrossfadePosition] =
    useState(CROSSFADE_POSITION);
  const [leftVolume, setLeftVolume] = useState(1);
  const [rightVolume, setRightVolume] = useState(1);
  const [leftIsPlaying, setLeftIsPlaying] = useState(false);
  const [rightIsPlaying, setRightIsPlaying] = useState(false);
  const [leftIsLoading, setLeftIsLoading] = useState(false);
  const [rightIsLoading, setRightIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [masterVolume, setMasterVolume] = useState(1);
  const [leftMuted, setLeftMuted] = useState(false);
  const [rightMuted, setRightMuted] = useState(false);
  const [leftSoundId, setLeftSoundId] = useState<string | null>(null);
  const [rightSoundId, setRightSoundId] = useState<string | null>(null);
  // Simple filter controls (separate from effect chain)
  const [leftFilterConfig, setLeftFilterConfig] = useState<FilterConfig>({
    type: "lowpass",
    frequency: 1000,
    Q: 1,
    gain: 0,
    enabled: false,
  });
  const [rightFilterConfig, setRightFilterConfig] = useState<FilterConfig>({
    type: "lowpass",
    frequency: 1000,
    Q: 1,
    gain: 0,
    enabled: false,
  });

  // New unified effect system
  const [leftEffects, setLeftEffects] = useState<EffectConfig[]>([]);
  const [rightEffects, setRightEffects] = useState<EffectConfig[]>([]);

  const leftSoundIdRef = useRef<string | null>(null);
  const rightSoundIdRef = useRef<string | null>(null);
  const leftEffectsRef = useRef<EffectConfig[]>([]);
  const rightEffectsRef = useRef<EffectConfig[]>([]);
  const leftUnsubscribeRef = useRef<(() => void) | null>(null);
  const rightUnsubscribeRef = useRef<(() => void) | null>(null);

  // Generate unique sound ID (matches format used in dj-player)
  const getSoundId = useCallback(
    (radio: Radio, side: "left" | "right") => `${side}_${radio.id}`,
    []
  );

  // Helper to reapply effects to a sound
  const reapplyEffects = useCallback(
    (soundId: string, effects: EffectConfig[]) => {
      if (effects.length > 0) {
        for (const effect of effects) {
          audioManager.addEffect(soundId, effect);
        }
      }
    },
    [audioManager]
  );

  // Helper to get side-specific refs
  const getSideRefs = useCallback((side: "left" | "right") => {
    if (side === "left") {
      return {
        soundIdRef: leftSoundIdRef,
        unsubscribeRef: leftUnsubscribeRef,
        effectsRef: leftEffectsRef,
        setIsLoading: setLeftIsLoading,
        setIsPlaying: setLeftIsPlaying,
        setRadioState: setLeftRadioState,
      };
    }
    return {
      soundIdRef: rightSoundIdRef,
      unsubscribeRef: rightUnsubscribeRef,
      effectsRef: rightEffectsRef,
      setIsLoading: setRightIsLoading,
      setIsPlaying: setRightIsPlaying,
      setRadioState: setRightRadioState,
    };
  }, []);

  // Helper to clean up existing subscription
  const cleanupExistingSubscription = useCallback(
    (side: "left" | "right") => {
      const { unsubscribeRef } = getSideRefs(side);
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    },
    [getSideRefs]
  );

  // Helper to create subscription callback
  const createSubscriptionCallback = useCallback(
    (side: "left" | "right") => {
      const { setIsPlaying, setIsLoading } = getSideRefs(side);
      return (state: AudioState) => {
        setIsPlaying(state.isPlaying);
        setIsLoading(state.isLoading);
        if (state.error) {
          setError(state.error.message);
        }
      };
    },
    [getSideRefs]
  );

  // Helper to finalize sound loading
  const finalizeSoundLoading = useCallback(
    (soundId: string, radio: Radio, side: "left" | "right") => {
      const { soundIdRef, setIsLoading, setRadioState, effectsRef } =
        getSideRefs(side);
      soundIdRef.current = soundId;
      if (side === "left") {
        setLeftSoundId(soundId);
      } else {
        setRightSoundId(soundId);
      }
      setRadioState(radio);
      setIsLoading(false);
      reapplyEffects(soundId, effectsRef.current);
    },
    [getSideRefs, reapplyEffects]
  );

  // Load sound for a specific side
  const loadSound = useCallback(
    async (radio: Radio, side: "left" | "right") => {
      const soundId = getSoundId(radio, side);
      const { soundIdRef, setIsLoading } = getSideRefs(side);

      try {
        setError(null);
        setIsLoading(true);

        cleanupExistingSubscription(side);

        const existingSoundId = soundIdRef.current;
        if (existingSoundId) {
          audioManager.cleanupSound(existingSoundId);
        }

        await audioManager.createSound(radio, soundId);

        const unsubscribe = audioManager.subscribe(
          soundId,
          createSubscriptionCallback(side)
        );
        const { unsubscribeRef } = getSideRefs(side);
        unsubscribeRef.current = unsubscribe;

        finalizeSoundLoading(soundId, radio, side);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to load sound";
        setError(errorMessage);
        setIsLoading(false);
      }
    },
    [
      audioManager,
      getSoundId,
      getSideRefs,
      cleanupExistingSubscription,
      createSubscriptionCallback,
      finalizeSoundLoading,
    ]
  );

  // Apply crossfade to current playbacks
  const applyCrossfade = useCallback(() => {
    const leftFinalVol = (1 - crossfadePosition) * leftVolume;
    const rightFinalVol = crossfadePosition * rightVolume;

    if (leftSoundIdRef.current) {
      audioManager.setVolume(leftSoundIdRef.current, leftFinalVol);
    }
    if (rightSoundIdRef.current) {
      audioManager.setVolume(rightSoundIdRef.current, rightFinalVol);
    }
  }, [audioManager, crossfadePosition, leftVolume, rightVolume]);

  // Update crossfade when position or volumes change
  useEffect(() => {
    applyCrossfade();
  }, [applyCrossfade]);

  // Set left radio
  const setLeftRadio = useCallback(
    async (radio: Radio | null) => {
      if (radio) {
        await loadSound(radio, "left");
      } else {
        // Unsubscribe from state changes
        if (leftUnsubscribeRef.current) {
          leftUnsubscribeRef.current();
          leftUnsubscribeRef.current = null;
        }
        // Clean up left sound
        if (leftSoundIdRef.current) {
          audioManager.cleanupSound(leftSoundIdRef.current);
          leftSoundIdRef.current = null;
        }
        setLeftSoundId(null);
        setLeftRadioState(null);
        setLeftIsPlaying(false);
        setLeftIsLoading(false);
      }
    },
    [loadSound, audioManager]
  );

  // Set right radio
  const setRightRadio = useCallback(
    async (radio: Radio | null) => {
      if (radio) {
        await loadSound(radio, "right");
      } else {
        // Unsubscribe from state changes
        if (rightUnsubscribeRef.current) {
          rightUnsubscribeRef.current();
          rightUnsubscribeRef.current = null;
        }
        // Clean up right sound
        if (rightSoundIdRef.current) {
          audioManager.cleanupSound(rightSoundIdRef.current);
          rightSoundIdRef.current = null;
        }
        setRightSoundId(null);
        setRightRadioState(null);
        setRightIsPlaying(false);
        setRightIsLoading(false);
      }
    },
    [loadSound, audioManager]
  );

  // Play left
  const playLeft = useCallback(async () => {
    if (leftSoundIdRef.current && !leftIsPlaying) {
      try {
        await audioManager.playSound(leftSoundIdRef.current, leftVolume);
        applyCrossfade();
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to play left";
        setError(errorMessage);
      }
    }
  }, [audioManager, leftIsPlaying, leftVolume, applyCrossfade]);

  // Pause left
  const pauseLeft = useCallback(() => {
    if (leftSoundIdRef.current) {
      audioManager.pauseSound(leftSoundIdRef.current);
    }
  }, [audioManager]);

  // Play right
  const playRight = useCallback(async () => {
    if (rightSoundIdRef.current && !rightIsPlaying) {
      try {
        await audioManager.playSound(rightSoundIdRef.current, rightVolume);
        applyCrossfade();
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to play right";
        setError(errorMessage);
      }
    }
  }, [audioManager, rightIsPlaying, rightVolume, applyCrossfade]);

  // Pause right
  const pauseRight = useCallback(() => {
    if (rightSoundIdRef.current) {
      audioManager.pauseSound(rightSoundIdRef.current);
    }
  }, [audioManager]);

  // Set left volume
  const setLeftVolumeCallback = useCallback(
    (volume: number) => {
      setLeftVolume(volume);
      applyCrossfade();
    },
    [applyCrossfade]
  );

  // Set right volume
  const setRightVolumeCallback = useCallback(
    (volume: number) => {
      setRightVolume(volume);
      applyCrossfade();
    },
    [applyCrossfade]
  );

  // Set crossfade position
  const setCrossfadePositionCallback = useCallback(
    (position: number) => {
      setCrossfadePosition(position);
      applyCrossfade();
    },
    [applyCrossfade]
  );

  // Master volume control
  const setMasterVolumeCallback = useCallback(
    (volume: number) => {
      setMasterVolume(volume);
      audioManager.setGlobalVolume(volume);
    },
    [audioManager]
  );

  // Mute controls
  const setLeftMuteCallback = useCallback(
    (muted: boolean) => {
      setLeftMuted(muted);
      if (leftSoundIdRef.current) {
        if (muted) {
          audioManager.muteSound(leftSoundIdRef.current);
        } else {
          audioManager.unmuteSound(leftSoundIdRef.current);
        }
      }
    },
    [audioManager]
  );

  const setRightMuteCallback = useCallback(
    (muted: boolean) => {
      setRightMuted(muted);
      if (rightSoundIdRef.current) {
        if (muted) {
          audioManager.muteSound(rightSoundIdRef.current);
        } else {
          audioManager.unmuteSound(rightSoundIdRef.current);
        }
      }
    },
    [audioManager]
  );

  // Filter controls
  const updateLeftFilterCallback = useCallback(
    (config: FilterConfig) => {
      setLeftFilterConfig(config);
      if (leftSoundIdRef.current) {
        audioManager.updateFilter(leftSoundIdRef.current, config);
      }
    },
    [audioManager]
  );

  const updateRightFilterCallback = useCallback(
    (config: FilterConfig) => {
      setRightFilterConfig(config);
      if (rightSoundIdRef.current) {
        audioManager.updateFilter(rightSoundIdRef.current, config);
      }
    },
    [audioManager]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Synchronous cleanup: unsubscribe and capture IDs
      const leftId = leftSoundIdRef.current;
      const rightId = rightSoundIdRef.current;

      if (leftUnsubscribeRef.current) {
        leftUnsubscribeRef.current();
        leftUnsubscribeRef.current = null;
      }
      if (rightUnsubscribeRef.current) {
        rightUnsubscribeRef.current();
        rightUnsubscribeRef.current = null;
      }

      // Clear refs synchronously
      leftSoundIdRef.current = null;
      rightSoundIdRef.current = null;

      // Cleanup sounds (sync operation now)
      if (leftId) {
        audioManager.cleanupSound(leftId);
      }
      setLeftSoundId(null);
      if (rightId) {
        audioManager.cleanupSound(rightId);
      }
      setRightSoundId(null);
    };
  }, [audioManager]);

  // New effect management functions
  const addLeftEffect = useCallback(
    (effectType: string) => {
      const soundId = leftSoundIdRef.current;
      if (!soundId) {
        return;
      }

      const newEffect = createDefaultEffectConfig(
        effectType as EffectConfig["type"],
        `effect_${Date.now()}_${Math.random()}`,
        leftEffectsRef.current.length
      );

      setLeftEffects((prev) => {
        const updated = [...prev, newEffect];
        leftEffectsRef.current = updated;
        return updated;
      });
      audioManager.addEffect(soundId, newEffect);
    },
    [audioManager]
  );

  const addRightEffect = useCallback(
    (effectType: string) => {
      const soundId = rightSoundIdRef.current;
      if (!soundId) {
        return;
      }

      const newEffect = createDefaultEffectConfig(
        effectType as EffectConfig["type"],
        `effect_${Date.now()}_${Math.random()}`,
        rightEffectsRef.current.length
      );

      setRightEffects((prev) => {
        const updated = [...prev, newEffect];
        rightEffectsRef.current = updated;
        return updated;
      });
      audioManager.addEffect(soundId, newEffect);
    },
    [audioManager]
  );

  const updateLeftEffect = useCallback(
    (effectId: string, config: Partial<EffectConfig>) => {
      const soundId = leftSoundIdRef.current;
      if (!soundId) {
        return;
      }

      // Optimistic update
      const previousEffects = leftEffects;
      setLeftEffects(
        (prev) =>
          prev.map((e) =>
            e.id === effectId ? { ...e, ...config } : e
          ) as EffectConfig[]
      );

      // Update in audio manager (returns boolean)
      const success = audioManager.updateEffect(soundId, effectId, config);
      if (!success) {
        // Revert optimistic update on failure
        setLeftEffects(previousEffects);
      }
    },
    [audioManager, leftEffects]
  );

  const updateRightEffect = useCallback(
    (effectId: string, config: Partial<EffectConfig>) => {
      const soundId = rightSoundIdRef.current;
      if (!soundId) {
        return;
      }

      // Optimistic update
      const previousEffects = rightEffects;
      setRightEffects(
        (prev) =>
          prev.map((e) =>
            e.id === effectId ? { ...e, ...config } : e
          ) as EffectConfig[]
      );

      // Update in audio manager (returns boolean)
      const success = audioManager.updateEffect(soundId, effectId, config);
      if (!success) {
        // Revert optimistic update on failure
        setRightEffects(previousEffects);
      }
    },
    [audioManager, rightEffects]
  );

  const removeLeftEffect = useCallback(
    (effectId: string) => {
      const soundId = leftSoundIdRef.current;
      if (!soundId) {
        return;
      }

      setLeftEffects((prev) => {
        const filtered = prev.filter((e) => e.id !== effectId);
        // Reorder remaining effects
        return filtered.map((e, i) => ({ ...e, order: i }));
      });
      audioManager.removeEffect(soundId, effectId);
    },
    [audioManager]
  );

  const removeRightEffect = useCallback(
    (effectId: string) => {
      const soundId = rightSoundIdRef.current;
      if (!soundId) {
        return;
      }

      setRightEffects((prev) => {
        const filtered = prev.filter((e) => e.id !== effectId);
        // Reorder remaining effects
        return filtered.map((e, i) => ({ ...e, order: i }));
      });
      audioManager.removeEffect(soundId, effectId);
    },
    [audioManager]
  );

  const reorderLeftEffects = useCallback(
    (effectIds: string[]) => {
      const soundId = leftSoundIdRef.current;
      if (!soundId) {
        return;
      }

      setLeftEffects((prev) => {
        const reordered = effectIds
          .map((id) => prev.find((e) => e.id === id))
          .filter((e): e is EffectConfig => e !== undefined)
          .map((e, i) => ({ ...e, order: i }));
        return reordered;
      });
      audioManager.reorderEffects(soundId, effectIds);
    },
    [audioManager]
  );

  const reorderRightEffects = useCallback(
    (effectIds: string[]) => {
      const soundId = rightSoundIdRef.current;
      if (!soundId) {
        return;
      }

      setRightEffects((prev) => {
        const reordered = effectIds
          .map((id) => prev.find((e) => e.id === id))
          .filter((e): e is EffectConfig => e !== undefined)
          .map((e, i) => ({ ...e, order: i }));
        return reordered;
      });
      audioManager.reorderEffects(soundId, effectIds);
    },
    [audioManager]
  );

  // Keep effects refs in sync with state
  useEffect(() => {
    leftEffectsRef.current = leftEffects;
  }, [leftEffects]);

  useEffect(() => {
    rightEffectsRef.current = rightEffects;
  }, [rightEffects]);

  return {
    leftRadio,
    rightRadio,
    crossfadePosition,
    leftVolume,
    rightVolume,
    leftIsPlaying,
    rightIsPlaying,
    leftIsLoading,
    rightIsLoading,
    error,
    masterVolume,
    leftMuted,
    rightMuted,
    // Simple filter controls
    leftFilterConfig,
    rightFilterConfig,
    // Effect chain
    leftEffects,
    rightEffects,
    // Sound IDs for effect initialization
    leftSoundId,
    rightSoundId,
    setLeftRadio,
    setRightRadio,
    setCrossfadePosition: setCrossfadePositionCallback,
    setLeftVolume: setLeftVolumeCallback,
    setRightVolume: setRightVolumeCallback,
    setMasterVolume: setMasterVolumeCallback,
    setLeftMute: setLeftMuteCallback,
    setRightMute: setRightMuteCallback,
    // Simple filter controls
    updateLeftFilter: updateLeftFilterCallback,
    updateRightFilter: updateRightFilterCallback,
    // Effect chain
    addLeftEffect,
    addRightEffect,
    updateLeftEffect,
    updateRightEffect,
    removeLeftEffect,
    removeRightEffect,
    reorderLeftEffects,
    reorderRightEffects,
    playLeft,
    pauseLeft,
    playRight,
    pauseRight,
  };
}
