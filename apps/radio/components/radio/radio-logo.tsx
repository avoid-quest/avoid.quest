"use client";

import { cn } from "@workspace/ui/lib/utils";
import { AudioLines } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

type RadioLogoProps = {
  logoUrl?: string;
  name: string;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  className?: string;
  fallbackIcon?: React.ReactNode;
};

const sizeMap = {
  sm: "size-8",
  md: "size-10",
  lg: "size-12",
  xl: "size-20",
  "2xl": "size-24",
};

const sizePixels = {
  sm: 32,
  md: 40,
  lg: 48,
  xl: 80,
  "2xl": 96,
};

export function RadioLogo({
  logoUrl,
  name,
  size = "md",
  className,
  fallbackIcon,
}: RadioLogoProps) {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const handleImageError = () => {
    setImageError(true);
  };

  const handleImageLoad = () => {
    setImageLoaded(true);
  };

  // If no logo URL or image failed to load, show fallback
  if (!logoUrl || imageError) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-sm bg-muted",
          sizeMap[size],
          className
        )}
      >
        {fallbackIcon || (
          <AudioLines className="size-4 text-muted-foreground" />
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-sm",
        sizeMap[size],
        className
      )}
    >
      <Image
        alt={`${name} logo`}
        className={cn(
          "rounded-sm object-contain transition-opacity",
          sizeMap[size],
          imageLoaded ? "opacity-100" : "opacity-0"
        )}
        height={sizePixels[size]}
        onError={handleImageError}
        onLoad={handleImageLoad}
        src={logoUrl}
        style={{
          // Theme-aware background for transparent logos
          backgroundColor: "var(--card)",
          // Add subtle border for better definition
          border: "1px solid var(--border)",
          // Ensure logos with white/black backgrounds are visible
          filter: "contrast(1.1) brightness(1.05)",
        }}
        width={sizePixels[size]}
      />
      {/* Loading state */}
      {!(imageLoaded || imageError) && (
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center rounded-sm bg-muted",
            sizeMap[size]
          )}
        >
          <AudioLines className="size-4 animate-pulse text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
