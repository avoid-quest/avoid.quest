/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { cn } from "@avoid.quest/ui/lib/utils";
import { RadioIcon } from "lucide-react";
import { useState } from "react";

type RadioLogoProps = {
  logoUrl?: string;
  name: string;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl";
  className?: string;
  fallbackIcon?: React.ReactNode;
};

const sizeMap = {
  "2xl": "size-24",
  "3xl": "size-28",
  "4xl": "size-52",
  lg: "size-12",
  md: "size-10",
  sm: "size-8",
  xl: "size-20",
};

const sizePixels = {
  "2xl": 96,
  "3xl": 112,
  "4xl": 208,
  lg: 48,
  md: 40,
  sm: 32,
  xl: 80,
};

const iconSizeMap = {
  "2xl": "size-7",
  "3xl": "size-8",
  "4xl": "size-12",
  lg: "size-5",
  md: "size-4",
  sm: "size-4",
  xl: "size-6",
};

const imagePaddingMap = {
  "2xl": "p-1",
  "3xl": "p-1.5",
  "4xl": "p-2",
  lg: "p-0.5",
  md: "p-0.5",
  sm: "p-0.5",
  xl: "p-1",
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
          "flex items-center justify-center rounded-sm border border-border/70 bg-muted",
          sizeMap[size],
          className
        )}
      >
        {fallbackIcon || (
          <RadioIcon
            className={cn(iconSizeMap[size], "text-muted-foreground")}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-sm border border-border/70 bg-muted",
        sizeMap[size],
        className
      )}
    >
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: onError and onLoad are valid img event handlers */}
      <img
        alt={`${name} logo`}
        className={cn(
          "size-full rounded-sm object-contain transition-opacity",
          imagePaddingMap[size],
          imageLoaded ? "opacity-100" : "opacity-0"
        )}
        height={sizePixels[size]}
        onError={handleImageError}
        onLoad={handleImageLoad}
        src={logoUrl}
        width={sizePixels[size]}
      />
      {/* Loading state */}
      {!(imageLoaded || imageError) && (
        <div className="absolute inset-0 flex items-center justify-center rounded-sm bg-muted">
          <RadioIcon
            className={cn(
              iconSizeMap[size],
              "animate-pulse text-muted-foreground"
            )}
          />
        </div>
      )}
    </div>
  );
}
