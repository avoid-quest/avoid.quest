import type { PinResponse } from "@avoid.quest/pinterest";
import { Application, Sprite, Texture } from "pixi.js";
import { memo, useEffect, useRef, useState } from "react";
import { canRenderEffects, useCapabilities } from "@/lib/effects";
import type { ScrollState } from "@/lib/effects/types";
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
  pins: PinResponse[];
  scrollState: ScrollState;
  imageSize: string;
};

export const EffectsCanvas = memo(function EffectsCanvas({
  pins,
  scrollState,
  imageSize,
}: EffectsCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const spriteFromRef = useRef<Sprite | null>(null);
  const spriteToRef = useRef<Sprite | null>(null);
  const textureCache = useRef<Map<string, Texture>>(new Map());
  const [isReady, setIsReady] = useState(false);

  // Track loaded texture indices to avoid redundant loads
  const loadedFromIndex = useRef<number>(-1);
  const loadedToIndex = useRef<number>(-1);

  const capabilities = useCapabilities();
  const { data: settings } = useSettings();
  const effectsEnabled = settings?.effectsEnabled ?? false;
  const snapEnabled = settings?.snapEnabled ?? false;

  const shouldRender = effectsEnabled && canRenderEffects(capabilities);

  // Initialize PixiJS application
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

        containerRef.current.appendChild(app.canvas);
        appRef.current = app;

        // Create two sprites for crossfade
        // spriteFrom = background (current image)
        // spriteTo = foreground (next image, fades in)
        const spriteFrom = new Sprite();
        spriteFrom.anchor.set(0.5);
        app.stage.addChild(spriteFrom);
        spriteFromRef.current = spriteFrom;

        const spriteTo = new Sprite();
        spriteTo.anchor.set(0.5);
        spriteTo.alpha = 0;
        app.stage.addChild(spriteTo);
        spriteToRef.current = spriteTo;

        setIsReady(true);
      } catch (err) {
        console.error("Failed to initialize PixiJS:", err);
      }
    };

    initApp();

    return () => {
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
        setIsReady(false);
      }
      textureCache.current.clear();
      loadedFromIndex.current = -1;
      loadedToIndex.current = -1;
    };
  }, [shouldRender]);

  // Load texture via proxy
  const loadTexture = async (url: string): Promise<Texture | null> => {
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
      return texture;
    } catch (err) {
      console.error("Failed to load texture:", url, err);
      return null;
    }
  };

  // Get image URL for a pin
  const getImageUrl = (pin: PinResponse): string | undefined => {
    return pin.images[imageSize as keyof typeof pin.images]?.url;
  };

  // Update sprites based on scroll state
  useEffect(() => {
    if (!(isReady && appRef.current) || pins.length === 0) {
      return;
    }

    const app = appRef.current;
    const spriteFrom = spriteFromRef.current;
    const spriteTo = spriteToRef.current;
    if (!(app && spriteFrom && spriteTo)) {
      return;
    }

    const { currentIndex, nextIndex, progress } = scrollState;
    const screenWidth = app.screen.width;
    const screenHeight = app.screen.height;

    const currentPin = pins[currentIndex];
    const nextPin = pins[nextIndex];

    if (!currentPin) {
      return;
    }

    const updateSprites = async () => {
      // Load current image into spriteFrom (if not already loaded)
      if (loadedFromIndex.current !== currentIndex) {
        const currentUrl = getImageUrl(currentPin);
        if (currentUrl) {
          const texture = await loadTexture(currentUrl);
          if (texture) {
            spriteFrom.texture = texture;
            fitSpriteToScreen(spriteFrom, screenWidth, screenHeight);
            loadedFromIndex.current = currentIndex;
          }
        }
      }

      // Load next image into spriteTo (if not already loaded)
      if (nextPin && loadedToIndex.current !== nextIndex) {
        const nextUrl = getImageUrl(nextPin);
        if (nextUrl) {
          const texture = await loadTexture(nextUrl);
          if (texture) {
            spriteTo.texture = texture;
            fitSpriteToScreen(spriteTo, screenWidth, screenHeight);
            loadedToIndex.current = nextIndex;
          }
        }
      }

      // Apply transition effect
      if (snapEnabled) {
        // Instant swap at 50% threshold
        const showNext = progress >= 0.5;
        spriteFrom.alpha = showNext ? 0 : 1;
        spriteTo.alpha = showNext ? 1 : 0;
      } else {
        // Smooth crossfade
        spriteTo.alpha = progress;
      }
    };

    updateSprites();
  }, [isReady, pins, scrollState, imageSize, snapEnabled]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      const app = appRef.current;
      const spriteFrom = spriteFromRef.current;
      const spriteTo = spriteToRef.current;
      if (!app) {
        return;
      }

      const screenWidth = app.screen.width;
      const screenHeight = app.screen.height;

      if (spriteFrom?.texture) {
        fitSpriteToScreen(spriteFrom, screenWidth, screenHeight);
      }
      if (spriteTo?.texture) {
        fitSpriteToScreen(spriteTo, screenWidth, screenHeight);
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
      className="pointer-events-none fixed inset-0 z-20"
      ref={containerRef}
      style={{
        opacity: isReady ? 1 : 0,
        transition: "opacity 0.3s ease-in-out",
      }}
    />
  );
});
