"use client";

import { Range, Root, Thumb, Track } from "@radix-ui/react-slider";
import { cn } from "@workspace/ui/lib/utils";
import { type ComponentProps, useMemo } from "react";

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  onValueChange,
  ...props
}: ComponentProps<typeof Root>) {
  const _values = useMemo(
    () =>
      Array.isArray(value)
        ? value
        : // biome-ignore lint/style/noNestedTernary: shadcn
          Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  );

  const _defaultValue = useMemo(() => {
    if (Array.isArray(defaultValue)) {
      return defaultValue;
    }
    if (defaultValue !== undefined) {
      return [defaultValue];
    }
    return;
  }, [defaultValue]);

  const handleReset = (
    index: number,
    e?: React.MouseEvent | React.TouchEvent
  ) => {
    if (!(onValueChange && _defaultValue)) {
      return;
    }
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const newValues = [..._values];
    newValues[index] = _defaultValue[index] ?? _defaultValue[0] ?? min;
    onValueChange(newValues);
  };

  const handleClick = (index: number, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.detail === 2) {
      handleReset(index, e);
    }
  };

  const handleTouchEnd = (index: number, e: React.TouchEvent) => {
    if (e.detail === 2) {
      handleReset(index, e);
    }
  };

  return (
    <Root
      className={cn(
        "relative flex touch-none select-none items-center data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col data-[disabled]:opacity-50",
        className
      )}
      data-slot="slider"
      defaultValue={defaultValue}
      max={max}
      min={min}
      onValueChange={onValueChange}
      value={value}
      {...props}
    >
      <Track
        className={cn(
          "relative grow overflow-hidden rounded-full bg-muted data-[orientation=horizontal]:h-1.5 data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-1.5"
        )}
        data-slot="slider-track"
      >
        <Range
          className={cn(
            "absolute bg-primary data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
          )}
          data-slot="slider-range"
        />
      </Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <Thumb
          className="block size-4 shrink-0 rounded-full border border-primary light:border-primary/80 bg-white light:bg-background shadow-sm ring-ring/50 transition-[color,box-shadow] hover:ring-4 focus-visible:outline-hidden focus-visible:ring-4 disabled:pointer-events-none disabled:opacity-50 dark:bg-white"
          data-slot="slider-thumb"
          // biome-ignore lint/suspicious/noArrayIndexKey: shadcn
          key={index}
          onClick={(e) => handleClick(index, e)}
          onDoubleClick={(e) => handleReset(index, e)}
          onTouchEnd={(e) => handleTouchEnd(index, e)}
        />
      ))}
    </Root>
  );
}

export { Slider };
