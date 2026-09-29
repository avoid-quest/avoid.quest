/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
"use client";

import { cn } from "@avoid.quest/ui/lib/utils";
import { Range, Root, Thumb, Track } from "@radix-ui/react-slider";
import { type ComponentProps, type CSSProperties, useMemo } from "react";

type SliderProps = ComponentProps<typeof Root> & {
  /** "fader" draws a thicker track with a bar thumb, for mixer-style level controls. */
  variant?: "default" | "fader";
  /** "lg" makes a fader cap bigger, for the one control you grab while performing. */
  size?: "default" | "lg";
  defaultMarkerValue?: number;
  rangeOriginValue?: number;
};

type SliderOrientation = NonNullable<SliderProps["orientation"]>;

function getSliderValues({
  defaultValue,
  max,
  min,
  value,
}: {
  defaultValue: SliderProps["defaultValue"];
  max: number;
  min: number;
  value: SliderProps["value"];
}) {
  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(defaultValue)) {
    return defaultValue;
  }

  return [min, max];
}

function getDefaultValues(defaultValue: SliderProps["defaultValue"]) {
  if (Array.isArray(defaultValue)) {
    return defaultValue;
  }

  if (defaultValue !== undefined) {
    return [defaultValue];
  }
}

function getPercent(value: number, min: number, max: number) {
  if (max === min) {
    return 0;
  }
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

function getRangeStyle({
  orientation,
  originPercent,
  valuePercent,
}: {
  orientation: SliderOrientation;
  originPercent: number | undefined;
  valuePercent: number;
}) {
  if (originPercent === undefined) {
    return;
  }

  if (orientation === "vertical") {
    return {
      bottom: `${Math.min(originPercent, valuePercent)}%`,
      height: `${Math.abs(valuePercent - originPercent)}%`,
    } satisfies CSSProperties;
  }

  return {
    left: `${Math.min(originPercent, valuePercent)}%`,
    width: `${Math.abs(valuePercent - originPercent)}%`,
  } satisfies CSSProperties;
}

function getMarkerStyle({
  markerPercent,
  orientation,
}: {
  markerPercent: number | undefined;
  orientation: SliderOrientation;
}) {
  if (markerPercent === undefined) {
    return;
  }

  if (orientation === "vertical") {
    return {
      bottom: `${markerPercent}%`,
    } satisfies CSSProperties;
  }

  return {
    left: `${markerPercent}%`,
  } satisfies CSSProperties;
}

function getThumbShapeClass(
  isFader: boolean,
  orientation: SliderOrientation,
  size: "default" | "lg"
): string {
  if (!isFader) {
    return "size-4 rounded-full";
  }
  // A fader cap: a bar with a centre grip line across it.
  const grip = "relative after:absolute after:bg-primary/50 after:content-['']";
  if (orientation === "vertical") {
    const dims = size === "lg" ? "h-5 w-9" : "h-3.5 w-7";
    return `${dims} rounded-sm ${grip} after:inset-x-1.5 after:top-1/2 after:h-px after:-translate-y-1/2`;
  }
  const dims = size === "lg" ? "h-9 w-5" : "h-7 w-3.5";
  return `${dims} rounded-sm ${grip} after:inset-y-1.5 after:left-1/2 after:w-px after:-translate-x-1/2`;
}

function getThumbIndex(event: React.SyntheticEvent<HTMLElement>) {
  return Number(event.currentTarget.dataset.index);
}

function Slider({
  className,
  defaultValue,
  defaultMarkerValue,
  value,
  min = 0,
  max = 100,
  onValueChange,
  orientation = "horizontal",
  rangeOriginValue,
  variant = "default",
  size = "default",
  "aria-label": ariaLabel,
  ...props
}: SliderProps) {
  const isFader = variant === "fader";
  const thumbShapeClass = getThumbShapeClass(isFader, orientation, size);
  const values = useMemo(
    () => getSliderValues({ defaultValue, max, min, value }),
    [value, defaultValue, min, max]
  );

  const defaultValues = useMemo(
    () => getDefaultValues(defaultValue),
    [defaultValue]
  );

  const markerPercent =
    defaultMarkerValue === undefined
      ? undefined
      : getPercent(defaultMarkerValue, min, max);
  const valuePercent = getPercent(values[0] ?? min, min, max);
  const originPercent =
    rangeOriginValue === undefined
      ? undefined
      : getPercent(rangeOriginValue, min, max);
  const rangeStyle = getRangeStyle({
    orientation,
    originPercent,
    valuePercent,
  });
  const markerStyle = getMarkerStyle({
    markerPercent,
    orientation,
  });

  const handleThumbInteraction = (
    e: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>
  ) => {
    const isModifiedClick =
      "metaKey" in e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
    const shouldReset =
      isModifiedClick || e.detail === 2 || e.type === "dblclick";
    if (!(onValueChange && defaultValues && shouldReset)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    const index = getThumbIndex(e);
    const newValues = [...values];
    newValues[index] = defaultValues[index] ?? defaultValues[0] ?? min;
    onValueChange(newValues);
  };

  return (
    <Root
      className={cn(
        "relative flex touch-none select-none items-center data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col data-[disabled]:opacity-50",
        className
      )}
      data-slot="slider"
      data-variant={variant}
      defaultValue={defaultValue}
      max={max}
      min={min}
      onValueChange={onValueChange}
      orientation={orientation}
      value={value}
      {...props}
    >
      <Track
        className={cn(
          "relative grow overflow-hidden rounded-full bg-muted data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full",
          isFader && size === "lg" && "data-[orientation=horizontal]:h-3",
          isFader && size !== "lg" && "data-[orientation=horizontal]:h-2",
          isFader && "data-[orientation=vertical]:w-2",
          !isFader &&
            "data-[orientation=horizontal]:h-1.5 data-[orientation=vertical]:w-1.5"
        )}
        data-slot="slider-track"
      >
        {rangeStyle ? (
          <div
            className="absolute bg-primary data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
            data-orientation={orientation}
            data-slot="slider-default-origin-range"
            style={rangeStyle}
          />
        ) : (
          <Range
            className={cn(
              "absolute bg-primary data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
            )}
            data-slot="slider-range"
          />
        )}
        {markerStyle && (
          <span
            className="pointer-events-none absolute z-10 bg-foreground/60 data-[orientation=horizontal]:h-full data-[orientation=vertical]:h-px data-[orientation=horizontal]:w-px data-[orientation=vertical]:w-full"
            data-orientation={orientation}
            data-slot="slider-default-marker"
            style={markerStyle}
          />
        )}
      </Track>
      {Array.from({ length: values.length }, (_, index) => (
        <Thumb
          aria-label={ariaLabel}
          className={cn(
            "block shrink-0 border border-primary light:border-primary/80 bg-white light:bg-background shadow-sm ring-ring/50 transition-[color,box-shadow] hover:ring-4 focus-visible:outline-hidden focus-visible:ring-4 disabled:pointer-events-none disabled:opacity-50 dark:bg-white",
            thumbShapeClass
          )}
          data-index={index}
          data-slot="slider-thumb"
          // biome-ignore lint/suspicious/noArrayIndexKey: shadcn
          key={index}
          onClick={handleThumbInteraction}
          onDoubleClick={handleThumbInteraction}
          onTouchEnd={handleThumbInteraction}
        />
      ))}
    </Root>
  );
}

export { Slider };
