/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
"use client";

import { useControlReset } from "@avoid.quest/ui/hooks/use-control-reset";
import { useFineWheel } from "@avoid.quest/ui/hooks/use-fine-wheel";
import { cn } from "@avoid.quest/ui/lib/utils";
import { Range, Root, Thumb, Track } from "@radix-ui/react-slider";
import {
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type SyntheticEvent,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

type SliderProps = ComponentProps<typeof Root> & {
  /** "fader" draws a thicker track with a bar thumb, for mixer-style level controls. */
  variant?: "default" | "fader";
  /** "lg" makes a fader cap bigger, for the one control you grab while performing. */
  size?: "default" | "lg";
  /** Gesture reset target; defaults to the initial defaultValue. */
  resetValue?: number[];
  /** Snap pointer changes near the reset target; keyboard and wheel nudges stay precise. */
  snapToDefault?: boolean;
  /** Whole-value wheel steps for discrete parameters; continuous parameters use 0.01. */
  wheelStep?: number;
  defaultMarkerValue?: number;
  rangeOriginValue?: number;
};

type SliderOrientation = NonNullable<SliderProps["orientation"]>;

function getSliderValues({
  defaultValue,
  min,
  value,
}: {
  defaultValue: SliderProps["defaultValue"];
  min: number;
  value: SliderProps["value"];
}) {
  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(defaultValue)) {
    return defaultValue;
  }

  return [min];
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

function composeHandlers<Event extends SyntheticEvent>(
  original: ((event: Event) => void) | undefined,
  gesture: (event: Event) => void
) {
  return (event: Event) => {
    original?.(event);
    if (!event.defaultPrevented) {
      gesture(event);
    }
  };
}

function Slider({
  className,
  defaultValue,
  defaultMarkerValue,
  value,
  min = 0,
  max = 100,
  step = 1,
  wheelStep,
  minStepsBetweenThumbs = 0,
  ref: forwardedRef,
  onValueChange,
  onValueCommit,
  disabled = false,
  orientation = "horizontal",
  rangeOriginValue,
  resetValue,
  snapToDefault = false,
  variant = "default",
  size = "default",
  "aria-label": ariaLabel,
  "aria-valuetext": ariaValueText,
  ...props
}: SliderProps) {
  const isFader = variant === "fader";
  const thumbShapeClass = getThumbShapeClass(isFader, orientation, size);
  const [internalValue, setInternalValue] = useState(() =>
    getSliderValues({ defaultValue, min, value })
  );
  const values = value ?? internalValue;
  const resetValues = resetValue ?? defaultValue;

  function applyValueChange(next: number[]) {
    if (value === undefined) {
      setInternalValue(next);
    }
    onValueChange?.(next);
  }

  const {
    changeValues: handleValueChange,
    elementRef,
    inputValues,
  } = useFineWheel<HTMLSpanElement>({
    disabled,
    max,
    min,
    minDistance: minStepsBetweenThumbs * step,
    onChange: applyValueChange,
    onCommit: onValueCommit,
    values,
    wheelStep,
  });
  useImperativeHandle(
    forwardedRef,
    () => elementRef.current as HTMLSpanElement,
    [elementRef]
  );

  // Radix recomputes each key press from the controlled value, so snapping a
  // keyboard step back to the reset target would leave the thumb stuck there.
  const keyboardChange = useRef(false);
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    props.onKeyDown?.(event);
    if (event.defaultPrevented) {
      return;
    }
    keyboardChange.current = true;
    // Radix handles this key synchronously after this handler returns.
    queueMicrotask(() => {
      keyboardChange.current = false;
    });
  }

  function handleSliderValueChange(next: number[]) {
    handleValueChange(
      snapToDefault && resetValues && !keyboardChange.current
        ? next.map((entry, index) => {
            const target = resetValues[index];
            return target !== undefined &&
              Math.abs(entry - target) < (max - min) * 0.02
              ? target
              : entry;
          })
        : next
    );
  }

  const reset = useControlReset(
    disabled || resetValues === undefined
      ? undefined
      : () => {
          const next = resetValues.map((entry) =>
            Math.max(min, Math.min(max, entry))
          );
          handleValueChange(next);
          onValueCommit?.(next);
        }
  );

  const markerPercent =
    defaultMarkerValue === undefined
      ? undefined
      : getPercent(defaultMarkerValue, min, max);
  const valuePercent = getPercent(inputValues[0] ?? min, min, max);
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

  return (
    <Root
      className={cn(
        "relative flex touch-none select-none items-center data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col data-[disabled]:opacity-50",
        className
      )}
      data-slot="slider"
      data-variant={variant}
      defaultValue={defaultValue}
      disabled={disabled}
      max={max}
      min={min}
      minStepsBetweenThumbs={minStepsBetweenThumbs}
      onValueChange={handleSliderValueChange}
      onValueCommit={onValueCommit}
      orientation={orientation}
      ref={elementRef}
      step={step}
      value={inputValues}
      {...props}
      onContextMenu={composeHandlers(props.onContextMenu, reset.onContextMenu)}
      onDoubleClick={composeHandlers(props.onDoubleClick, reset.onDoubleClick)}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={composeHandlers(
        props.onLostPointerCapture,
        reset.onPointerCancel
      )}
      onPointerCancel={composeHandlers(
        props.onPointerCancel,
        reset.onPointerCancel
      )}
      onPointerDown={composeHandlers(props.onPointerDown, reset.onPointerDown)}
      onPointerMove={composeHandlers(props.onPointerMove, reset.onPointerMove)}
      onPointerUp={composeHandlers(props.onPointerUp, reset.onPointerUp)}
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
      {Array.from({ length: inputValues.length }, (_, index) => (
        <Thumb
          aria-label={ariaLabel}
          aria-valuetext={ariaValueText}
          className={cn(
            "block shrink-0 border border-primary light:border-primary/80 bg-white light:bg-background shadow-sm ring-ring/50 transition-[color,box-shadow] hover:ring-4 focus-visible:outline-hidden focus-visible:ring-4 disabled:pointer-events-none disabled:opacity-50 dark:bg-white",
            thumbShapeClass
          )}
          data-index={index}
          data-slot="slider-thumb"
          // biome-ignore lint/suspicious/noArrayIndexKey: shadcn
          key={index}
        />
      ))}
    </Root>
  );
}

export { Slider };
