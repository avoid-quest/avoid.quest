import { useCallback, useEffect, useRef, useState } from "react";
import type { FilterConfig } from "@/components/audio/filter-control";
import type { Radio } from "../../types";
import { AudioManager } from "../audio-manager";
import { createDefaultEffectConfig } from "../effects/registry";
import type { EffectConfig } from "../effects/types";

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
  // Legacy filter/reverb configs for backward compatibility
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

  // Load sound for a specific side
  const loadSound = useCallback(
    async (radio: Radio, side: "left" | "right") => {
      const soundId = getSoundId(radio, side);

      try {
        setError(null);

        if (side === "left") {
          setLeftIsLoading(true);
        } else {
          setRightIsLoading(true);
        }

        // Clean up existing sound
        const existingSoundId =
          side === "left" ? leftSoundIdRef.current : rightSoundIdRef.current;
        if (existingSoundId) {
          await audioManager.cleanupSound(existingSoundId);
        }

        // Create new sound
        await audioManager.createSound(radio, soundId);

        // Subscribe to state changes
        const _unsubscribe = audioManager.subscribe(soundId, (state) => {
          if (side === "left") {
            setLeftIsPlaying(state.isPlaying);
            setLeftIsLoading(state.isLoading);
          } else {
            setRightIsPlaying(state.isPlaying);
            setRightIsLoading(state.isLoading);
          }

          if (state.error) {
            setError(state.error.message);
          }
        });

        // Update sound ID reference and reapply effects
        if (side === "left") {
          leftSoundIdRef.current = soundId;
          setLeftRadioState(radio);
          setLeftIsLoading(false);
          reapplyEffects(soundId, leftEffectsRef.current);
        } else {
          rightSoundIdRef.current = soundId;
          setRightRadioState(radio);
          setRightIsLoading(false);
          reapplyEffects(soundId, rightEffectsRef.current);
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to load sound";
        setError(errorMessage);

        if (side === "left") {
          setLeftIsLoading(false);
        } else {
          setRightIsLoading(false);
        }
      }
    },
    [audioManager, getSoundId, reapplyEffects]
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
        // Clean up left sound
        if (leftSoundIdRef.current) {
          await audioManager.cleanupSound(leftSoundIdRef.current);
          leftSoundIdRef.current = null;
        }
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
        // Clean up right sound
        if (rightSoundIdRef.current) {
          await audioManager.cleanupSound(rightSoundIdRef.current);
          rightSoundIdRef.current = null;
        }
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
    const cleanup = async () => {
      if (leftSoundIdRef.current) {
        await audioManager.cleanupSound(leftSoundIdRef.current);
        leftSoundIdRef.current = null;
      }
      if (rightSoundIdRef.current) {
        await audioManager.cleanupSound(rightSoundIdRef.current);
        rightSoundIdRef.current = null;
      }
    };

    return () => {
      cleanup();
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
        leftEffects.length
      );

      setLeftEffects((prev) => [...prev, newEffect]);
      audioManager.addEffect(soundId, newEffect);
    },
    [audioManager, leftEffects.length]
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
        rightEffects.length
      );

      setRightEffects((prev) => [...prev, newEffect]);
      audioManager.addEffect(soundId, newEffect);
    },
    [audioManager, rightEffects.length]
  );

  const updateLeftEffect = useCallback(
    (effectId: string, config: Partial<EffectConfig>) => {
      const soundId = leftSoundIdRef.current;
      if (!soundId) {
        return;
      }

      setLeftEffects(
        (prev) =>
          prev.map((e) =>
            e.id === effectId ? { ...e, ...config } : e
          ) as EffectConfig[]
      );
      audioManager.updateEffect(soundId, effectId, config);
    },
    [audioManager]
  );

  const updateRightEffect = useCallback(
    (effectId: string, config: Partial<EffectConfig>) => {
      const soundId = rightSoundIdRef.current;
      if (!soundId) {
        return;
      }

      setRightEffects(
        (prev) =>
          prev.map((e) =>
            e.id === effectId ? { ...e, ...config } : e
          ) as EffectConfig[]
      );
      audioManager.updateEffect(soundId, effectId, config);
    },
    [audioManager]
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
    // Legacy support
    leftFilterConfig,
    rightFilterConfig,
    // New unified effect system
    leftEffects,
    rightEffects,
    // Sound IDs for effect initialization
    leftSoundId: leftSoundIdRef.current,
    rightSoundId: rightSoundIdRef.current,
    setLeftRadio,
    setRightRadio,
    setCrossfadePosition: setCrossfadePositionCallback,
    setLeftVolume: setLeftVolumeCallback,
    setRightVolume: setRightVolumeCallback,
    setMasterVolume: setMasterVolumeCallback,
    setLeftMute: setLeftMuteCallback,
    setRightMute: setRightMuteCallback,
    // Legacy support
    updateLeftFilter: updateLeftFilterCallback,
    updateRightFilter: updateRightFilterCallback,
    // New unified effect system
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
