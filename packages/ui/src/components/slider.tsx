/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
"use client";

import { useControlReset } from "@avoid.quest/ui/hooks/use-control-reset";
import { useFineWheel } from "@avoid.quest/ui/hooks/use-fine-wheel";
import { cn } from "@avoid.quest/ui/lib/utils";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import {
  type CSSProperties,
  type SyntheticEvent,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

type SliderProps = Omit<SliderPrimitive.Root.Props<number[]>, "className"> & {
  className?: string;
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
    return "size-3";
  }
  // A fader cap: a bar with a centre grip line across it.
  const grip = "relative after:absolute after:bg-primary/50 after:content-['']";
  if (orientation === "vertical") {
    const dims = size === "lg" ? "h-5 w-9" : "h-3.5 w-7";
    return `${dims} ${grip} after:inset-x-1.5 after:top-1/2 after:h-px after:-translate-y-1/2`;
  }
  const dims = size === "lg" ? "h-9 w-5" : "h-7 w-3.5";
  return `${dims} ${grip} after:inset-y-1.5 after:left-1/2 after:w-px after:-translate-x-1/2`;
}

/** Custom wheel/reset gestures use Base UI's neutral reason and cancellation contract. */
function createGestureDetails(
  event: Event
): SliderPrimitive.Root.ChangeEventDetails {
  const details: SliderPrimitive.Root.ChangeEventDetails = {
    activeThumbIndex: getGestureThumbIndex(event) ?? 0,
    allowPropagation: () => {
      details.isPropagationAllowed = true;
    },
    cancel: () => {
      details.isCanceled = true;
    },
    event,
    isCanceled: false,
    isPropagationAllowed: false,
    reason: "none",
    trigger: undefined,
  };
  return details;
}

/** The thumb a reset gesture landed on, or null for the track. */
function getGestureThumbIndex(event: {
  target: EventTarget | null;
}): number | null {
  const { target } = event;
  const thumb =
    target && "closest" in target
      ? (target as HTMLElement).closest<HTMLElement>(
          '[data-slot="slider-thumb"]'
        )
      : null;
  const index = Number(thumb?.dataset.index);
  return Number.isInteger(index) ? index : null;
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
  minStepsBetweenValues = 0,
  ref: forwardedRef,
  onValueChange,
  onValueCommitted,
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
  const changeDetails = useRef<
    SliderPrimitive.Root.ChangeEventDetails | undefined
  >(undefined);
  const resetValues = resetValue ?? defaultValue;
  const suppressTouchStart = useRef<boolean>(false);

  function applyValueChange(next: number[], event?: Event) {
    const details =
      changeDetails.current ??
      createGestureDetails(event ?? new Event("change"));
    onValueChange?.(next, details);
    if (details.isCanceled) {
      return false;
    }
    if (value === undefined) {
      setInternalValue(next);
    }
    return true;
  }

  function commitGesture(next: number[], event?: Event) {
    onValueCommitted?.(next, {
      reason: "none",
      event: event ?? new Event("change"),
    });
  }

  const {
    changeValues: handleValueChange,
    elementRef,
    getRequestedValues,
    inputValues,
  } = useFineWheel<HTMLDivElement>({
    disabled,
    max,
    min,
    minDistance: minStepsBetweenValues * step,
    onChange: applyValueChange,
    onCommit: commitGesture,
    values,
    wheelStep,
  });
  useImperativeHandle(
    forwardedRef,
    () => elementRef.current as HTMLDivElement,
    [elementRef]
  );

  function handleSliderValueChange(
    next: number[],
    details: SliderPrimitive.Root.ChangeEventDetails
  ) {
    changeDetails.current = details;
    handleValueChange(
      snapToDefault && resetValues && details.reason !== "keyboard"
        ? next.map((entry, index) => {
            const target = resetValues[index];
            return target !== undefined &&
              Math.abs(entry - target) < (max - min) * 0.02
              ? target
              : entry;
          })
        : next,
      details.event
    );
    changeDetails.current = undefined;
  }

  const reset = useControlReset(
    disabled || resetValues === undefined
      ? undefined
      : (event) => {
          const clamp = (entry: number) => Math.max(min, Math.min(max, entry));
          // A gesture on one thumb resets only that thumb, stopping short of
          // its neighbours as a drag would; the track resets all.
          const thumbIndex = getGestureThumbIndex(event);
          const current = getRequestedValues();
          const distance = minStepsBetweenValues * step;
          const next =
            thumbIndex === null
              ? resetValues.map(clamp)
              : current.map((entry, index) => {
                  if (index !== thumbIndex) {
                    return entry;
                  }
                  const lower =
                    (current[index - 1] ?? min - distance) + distance;
                  const upper =
                    (current[index + 1] ?? max + distance) - distance;
                  const target = resetValues[index] ?? resetValues[0] ?? entry;
                  return clamp(Math.min(upper, Math.max(lower, target)));
                });
          if (handleValueChange(next, event.nativeEvent)) {
            commitGesture(next, event.nativeEvent);
          }
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
    <SliderPrimitive.Root
      className={cn(
        "relative flex touch-none select-none items-center data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col data-[disabled]:opacity-50 [@media(pointer:coarse)]:data-[orientation=horizontal]:min-h-11 [@media(pointer:coarse)]:data-[orientation=vertical]:min-w-11",
        className
      )}
      data-slot="slider"
      data-variant={variant}
      defaultValue={defaultValue}
      disabled={disabled}
      max={max}
      min={min}
      minStepsBetweenValues={minStepsBetweenValues}
      onValueChange={handleSliderValueChange}
      onValueCommitted={(_next, details) => {
        onValueCommitted?.(getRequestedValues(), details);
      }}
      orientation={orientation}
      ref={elementRef}
      step={step}
      thumbCollisionBehavior="none"
      value={inputValues}
      {...props}
      onContextMenu={composeHandlers(props.onContextMenu, reset.onContextMenu)}
      onDoubleClick={composeHandlers(props.onDoubleClick, reset.onDoubleClick)}
      onLostPointerCapture={composeHandlers(
        props.onLostPointerCapture,
        reset.onPointerCancel
      )}
      onPointerCancel={composeHandlers(
        props.onPointerCancel,
        reset.onPointerCancel
      )}
      onPointerDownCapture={(event) => {
        composeHandlers(props.onPointerDownCapture, reset.onPointerDown)(event);
        // A consumed pointer reset must also consume the compatibility touch
        // event, otherwise Base UI starts a second drag at the finger position.
        suppressTouchStart.current =
          event.pointerType === "touch" && event.defaultPrevented;
      }}
      onPointerMove={composeHandlers(props.onPointerMove, reset.onPointerMove)}
      onPointerUp={composeHandlers(props.onPointerUp, reset.onPointerUp)}
      onTouchStartCapture={(event) => {
        props.onTouchStartCapture?.(event);
        if (suppressTouchStart.current) {
          suppressTouchStart.current = false;
          event.stopPropagation();
        }
      }}
    >
      <SliderPrimitive.Control
        className="relative flex min-h-[inherit] min-w-[inherit] grow items-center data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full data-[orientation=vertical]:flex-col"
        data-slot="slider-control"
      >
        <SliderPrimitive.Track
          className={cn(
            "relative grow overflow-hidden bg-input/50 data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full",
            isFader && size === "lg" && "data-[orientation=horizontal]:h-3",
            isFader && size !== "lg" && "data-[orientation=horizontal]:h-2",
            isFader && "data-[orientation=vertical]:w-2",
            !isFader &&
              "data-[orientation=horizontal]:h-0.5 data-[orientation=vertical]:w-0.5"
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
            <SliderPrimitive.Indicator
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
        </SliderPrimitive.Track>
        {Array.from({ length: inputValues.length }, (_, index) => (
          <SliderPrimitive.Thumb
            aria-label={ariaLabel}
            aria-valuetext={ariaValueText}
            className={cn(
              "block shrink-0 border-none bg-primary transition-colors hover:ring-2 hover:ring-ring/30 has-[:focus-visible]:outline-hidden has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/30 data-disabled:pointer-events-none",
              thumbShapeClass
            )}
            data-index={index}
            data-slot="slider-thumb"
            index={index}
            // biome-ignore lint/suspicious/noArrayIndexKey: shadcn
            key={index}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
