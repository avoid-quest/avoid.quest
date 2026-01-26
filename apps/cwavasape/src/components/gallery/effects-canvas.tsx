import { Application, Container, Sprite, Texture } from "pixi.js";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisEffectsSettings } from "@/lib/collections/settings";
import { canRenderEffects, useCapabilities } from "@/lib/effects";
import type { ImageFeatures } from "@/lib/effects/feature-types";
import type { EffectPipeline } from "@/lib/effects/pipeline/effect-pipeline";
import { useSettings } from "@/lib/hooks/use-settings";
import { getProxiedImageUrl } from "@/lib/image-proxy";

/**
 * Scale and position a sprite to fit the screen (contain mode)
 */
function fitSpriteToScreen(
  sprite: Sprite,
  screenWidth: number,
  screenHeight: number
) {
  const texture = sprite.texture;
  if (!texture || texture.width === 0 || texture.height === 0) {
    return;
  }

  const scale = Math.min(
    screenWidth / texture.width,
    screenHeight / texture.height
  );
  sprite.scale.set(scale);
  sprite.position.set(screenWidth / 2, screenHeight / 2);
}

type EffectsCanvasProps = {
  prevImageUrl?: string;
  currentImageUrl?: string;
  nextImageUrl?: string;
  currentIndex: number;
  scrollProgress: number;
  analysisEffects?: AnalysisEffectsSettings;
};

export const EffectsCanvas = memo(function EffectsCanvas({
  prevImageUrl,
  currentImageUrl,
  nextImageUrl,
  currentIndex,
  scrollProgress,
  analysisEffects,
}: EffectsCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const spriteContainerRef = useRef<Container | null>(null);
  const spriteFromRef = useRef<Sprite | null>(null);
  const spriteToRef = useRef<Sprite | null>(null);
  const textureCache = useRef<Map<string, Texture>>(new Map());
  const featureCache = useRef<Map<string, ImageFeatures>>(new Map());
  const pipelineRef = useRef<EffectPipeline | null>(null);

  // Track load requests to handle race conditions during rapid scrolling
  // Each new load increments the version, stale loads check before applying
  const loadVersionRef = useRef<{ from: number; to: number }>({
    from: 0,
    to: 0,
  });
  const loadedFromIndexRef = useRef<number>(-1);
  const loadedToIndexRef = useRef<number>(-1);

  const [isReady, setIsReady] = useState(false);

  const capabilities = useCapabilities();
  const { data: settings } = useSettings();
  const effectsEnabled = settings?.effectsEnabled ?? false;
  const snapEnabled = settings?.snapEnabled ?? false;
  const shouldRender = effectsEnabled && canRenderEffects(capabilities);

  // Helper to update sprite alphas based on current state
  // Called both from scroll handler and after texture loads
  const updateSpriteAlphas = useCallback(
    (targetIndex: number, progress: number) => {
      const spriteFrom = spriteFromRef.current;
      const spriteTo = spriteToRef.current;
      const spriteContainer = spriteContainerRef.current;
      if (!(spriteFrom && spriteTo && spriteContainer)) {
        return;
      }

      const fromReady = loadedFromIndexRef.current === targetIndex;
      const toReady = loadedToIndexRef.current === targetIndex + 1;

      if (!fromReady) {
        // Textures not ready - fade out to hide wrong textures
        spriteContainer.alpha = 0.3;
        spriteFrom.alpha = 1;
        spriteTo.alpha = 0;
        return;
      }

      spriteContainer.alpha = 1;

      if (!toReady) {
        // Only from texture ready - no crossfade
        spriteFrom.alpha = 1;
        spriteTo.alpha = 0;
        return;
      }

      // Both textures ready - apply crossfade
      if (snapEnabled) {
        const showNext = progress >= 0.5;
        spriteFrom.alpha = showNext ? 0 : 1;
        spriteTo.alpha = showNext ? 1 : 0;
      } else {
        spriteFrom.alpha = 1 - progress;
        spriteTo.alpha = progress;
      }
    },
    [snapEnabled]
  );

  // Async texture loader (loads and caches)
  const loadTexture = useCallback(
    async (url: string): Promise<Texture | null> => {
      if (textureCache.current.has(url)) {
        return textureCache.current.get(url) ?? null;
      }

      try {
        const proxiedUrl = getProxiedImageUrl(url);
        const img = new Image();
        img.crossOrigin = "anonymous";

        const texture = await new Promise<Texture>((resolve, reject) => {
          img.onload = () => resolve(Texture.from(img));
          img.onerror = () => reject(new Error("Failed to load image"));
          img.src = proxiedUrl;
        });

        textureCache.current.set(url, texture);

        // Background feature extraction
        const app = appRef.current;
        if (app && !featureCache.current.has(url)) {
          import("@/lib/effects/feature-extractor")
            .then(({ extractFeatures }) => extractFeatures(app, texture, url))
            .then((features) => featureCache.current.set(url, features))
            .catch((err) => {
              if (import.meta.env.DEV) {
                console.warn("Feature extraction failed for", url, err);
              }
            });
        }

        return texture;
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn("Texture load failed for", url, err);
        }
        return null;
      }
    },
    []
  );

  // Initialize PixiJS
  useEffect(() => {
    if (!(containerRef.current && shouldRender)) {
      return;
    }
    if (appRef.current) {
      return;
    }

    const initApp = async () => {
      try {
        const app = new Application();
        await app.init({
          background: 0x00_00_00,
          resizeTo: window,
          antialias: true,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
          preference: "webgl",
        });

        if (!containerRef.current) {
          app.destroy(true);
          return;
        }

        // Ensure canvas doesn't capture pointer events (allows scrolling through)
        app.canvas.style.pointerEvents = "none";
        containerRef.current.appendChild(app.canvas);
        appRef.current = app;

        // Create a container to hold both sprites - effects apply to the container
        const spriteContainer = new Container();
        app.stage.addChild(spriteContainer);
        spriteContainerRef.current = spriteContainer;

        const spriteFrom = new Sprite();
        spriteFrom.anchor.set(0.5);
        spriteContainer.addChild(spriteFrom);
        spriteFromRef.current = spriteFrom;

        const spriteTo = new Sprite();
        spriteTo.anchor.set(0.5);
        spriteTo.alpha = 0;
        spriteContainer.addChild(spriteTo);
        spriteToRef.current = spriteTo;

        const { EffectPipeline } = await import(
          "@/lib/effects/pipeline/effect-pipeline"
        );
        const pipeline = new EffectPipeline();
        // Attach to container so effects apply to both sprites combined
        pipeline.attach(spriteContainer);
        pipelineRef.current = pipeline;

        setIsReady(true);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.error("Failed to initialize PixiJS:", err);
        }
        // Effects will gracefully degrade - shouldRender check prevents broken UI
      }
    };

    initApp();

    return () => {
      pipelineRef.current?.detach();
      pipelineRef.current = null;
      spriteContainerRef.current = null;
      appRef.current?.destroy(true, { children: true });
      appRef.current = null;
      setIsReady(false);
      textureCache.current.clear();
      featureCache.current.clear();
      loadedFromIndexRef.current = -1;
      loadedToIndexRef.current = -1;
      // Reset load versions to invalidate any in-flight requests
      loadVersionRef.current = { from: 0, to: 0 };
    };
  }, [shouldRender]);

  // Store current scroll progress in ref for texture load callbacks
  const scrollProgressRef = useRef(scrollProgress);
  scrollProgressRef.current = scrollProgress;

  // Load textures when index changes (NOT on every scroll)
  // Implements texture swapping: when index advances, spriteTo becomes spriteFrom
  useEffect(() => {
    const app = appRef.current;
    const spriteFrom = spriteFromRef.current;
    const spriteTo = spriteToRef.current;
    if (!(isReady && app && spriteFrom && spriteTo)) {
      return;
    }

    const screenWidth = app.screen.width;
    const screenHeight = app.screen.height;
    const nextIndex = currentIndex + 1;

    // Helper to create texture load callback with version tracking
    const createTextureCallback = (
      sprite: Sprite,
      indexRef: { current: number },
      targetIndex: number,
      versionKey: "from" | "to"
    ) => {
      const version = ++loadVersionRef.current[versionKey];
      return (tex: Texture | null) => {
        if (!tex || loadVersionRef.current[versionKey] !== version) {
          return;
        }
        sprite.texture = tex;
        fitSpriteToScreen(sprite, screenWidth, screenHeight);
        indexRef.current = targetIndex;
        updateSpriteAlphas(currentIndex, scrollProgressRef.current);
      };
    };

    // Check if we can swap textures (scrolling forward one step)
    const canSwap =
      loadedToIndexRef.current === currentIndex &&
      loadedFromIndexRef.current === currentIndex - 1 &&
      spriteTo.texture;

    if (canSwap) {
      // Swap: reuse spriteTo texture for spriteFrom
      spriteFrom.texture = spriteTo.texture;
      fitSpriteToScreen(spriteFrom, screenWidth, screenHeight);
      loadedFromIndexRef.current = currentIndex;
      // Load new next texture
      if (nextImageUrl) {
        loadTexture(nextImageUrl).then(
          createTextureCallback(spriteTo, loadedToIndexRef, nextIndex, "to")
        );
      }
      return;
    }

    // Full reload needed
    if (currentImageUrl && loadedFromIndexRef.current !== currentIndex) {
      loadTexture(currentImageUrl).then(
        createTextureCallback(
          spriteFrom,
          loadedFromIndexRef,
          currentIndex,
          "from"
        )
      );
    }
    if (nextImageUrl && loadedToIndexRef.current !== nextIndex) {
      loadTexture(nextImageUrl).then(
        createTextureCallback(spriteTo, loadedToIndexRef, nextIndex, "to")
      );
    }
    // Preload prev (cache warming only)
    if (prevImageUrl) {
      loadTexture(prevImageUrl);
    }
  }, [
    isReady,
    currentIndex,
    currentImageUrl,
    nextImageUrl,
    prevImageUrl,
    loadTexture,
    updateSpriteAlphas,
  ]);

  // Update alpha on every scroll
  useEffect(() => {
    updateSpriteAlphas(currentIndex, scrollProgress);
  }, [scrollProgress, currentIndex, updateSpriteAlphas]);

  // Apply analysis effects to the sprite container (affects both sprites)
  useEffect(() => {
    const pipeline = pipelineRef.current;
    if (!(pipeline && isReady)) {
      return;
    }

    if (analysisEffects) {
      pipeline.update(analysisEffects);
    } else {
      pipeline.clear();
    }
  }, [isReady, analysisEffects]);

  // Resize handler
  useEffect(() => {
    const handleResize = () => {
      const app = appRef.current;
      const spriteFrom = spriteFromRef.current;
      const spriteTo = spriteToRef.current;
      if (!app) {
        return;
      }

      const w = app.screen.width;
      const h = app.screen.height;
      if (spriteFrom?.texture) {
        fitSpriteToScreen(spriteFrom, w, h);
      }
      if (spriteTo?.texture) {
        fitSpriteToScreen(spriteTo, w, h);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed inset-0 z-40"
      ref={containerRef}
      style={{ opacity: isReady ? 1 : 0 }}
    />
  );
});
