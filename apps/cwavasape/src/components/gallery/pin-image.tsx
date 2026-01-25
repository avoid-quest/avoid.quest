import type { ImageSize, PinResponse } from "@avoid.quest/pinterest";
import { memo } from "react";

type PinImageProps = {
  pin: PinResponse;
  index: number;
  imageSize: ImageSize;
};

export const PinImage = memo(function PinImage({
  pin,
  index,
  imageSize,
}: PinImageProps) {
  const image = pin.images[imageSize];

  return (
    <div
      className="flex h-screen w-full items-center justify-center bg-black"
      data-pin-index={index}
    >
      <span className="absolute top-4 left-4 z-10 rounded-lg bg-white/90 px-3 py-1.5 font-mono text-black text-sm">
        {index + 1}
      </span>
      <img
        alt={pin.alt_text || pin.title || `Pin ${index + 1}`}
        className="h-screen w-screen object-contain"
        height={image.height}
        loading="lazy"
        src={image.url}
        width={image.width}
      />
    </div>
  );
});
