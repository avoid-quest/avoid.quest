import { useEffect, useEffectEvent, useRef, useState } from "react";

function sameValues(left: number[], right: number[]) {
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

function nudge(
  value: number,
  deltaY: number,
  min: number,
  discreteStep?: number
) {
  const next = value - Math.sign(deltaY) * (discreteStep ?? 0.01);
  const legal =
    discreteStep === undefined
      ? next
      : min + Math.round((next - min) / discreteStep) * discreteStep;
  return Number(legal.toPrecision(12));
}

/**
 * Throttled parents deliver the latest request within a few frames. Requests
 * still unacknowledged after this were never rendered, e.g. input that
 * returned to the parent's current value, so they must not claim a later
 * external update as their echo.
 */
const PENDING_TIMEOUT_MS = 500;

/** Share immediate control input while parent audio updates can remain throttled. */
export function useFineWheel<T extends HTMLElement>({
  values,
  min,
  max,
  wheelStep,
  minDistance = 0,
  disabled,
  onChange,
  onCommit,
}: {
  values: number[];
  min: number;
  max: number;
  /** Override only for discrete values, such as bit depth or integer script parameters. */
  wheelStep?: number;
  minDistance?: number;
  disabled?: boolean;
  onChange: (values: number[]) => void;
  onCommit?: (values: number[]) => void;
}) {
  const elementRef = useRef<T>(null);
  const [inputValues, setInputValues] = useState(values);
  const observed = useRef(values);
  const requested = useRef(values);
  const pending = useRef<number[][]>([]);
  const pendingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (sameValues(values, observed.current)) {
      return;
    }
    // Acknowledging an earlier request must not rewind newer control input.
    const index = pending.current.findIndex((next) => sameValues(next, values));
    pending.current = index < 0 ? [] : pending.current.slice(index + 1);
    requested.current = pending.current.at(-1) ?? values;
    observed.current = values;
    setInputValues(requested.current);
  }, [values]);

  useEffect(() => () => clearTimeout(pendingTimer.current), []);

  function changeValues(next: number[]) {
    if (!sameValues(next, requested.current)) {
      pending.current.push(next);
    }
    requested.current = next;
    setInputValues(next);
    clearTimeout(pendingTimer.current);
    pendingTimer.current = setTimeout(() => {
      if (pending.current.length > 0) {
        pending.current = [];
        requested.current = observed.current;
        setInputValues(observed.current);
      }
    }, PENDING_TIMEOUT_MS);
    onChange(next);
  }

  const handleWheel = useEffectEvent((event: WheelEvent) => {
    // Ctrl-wheel is the browser's pinch/zoom gesture, not a parameter change.
    if (disabled || event.ctrlKey || event.defaultPrevented || !event.deltaY) {
      return;
    }
    const thumb =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-index]")
        : null;
    const index = Number(thumb?.dataset.index ?? 0);
    const current = requested.current[index];
    if (current === undefined) {
      return;
    }
    const lower = Math.max(
      min,
      (requested.current[index - 1] ?? min - minDistance) + minDistance
    );
    const upper = Math.min(
      max,
      (requested.current[index + 1] ?? max + minDistance) - minDistance
    );
    const nextValue = Math.min(
      upper,
      Math.max(lower, nudge(current, event.deltaY, min, wheelStep))
    );
    if (nextValue === current) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const next = [...requested.current];
    next[index] = nextValue;
    changeValues(next);
    onCommit?.(next);
  });

  useEffect(() => {
    const element = elementRef.current;
    // React's delegated wheel listener is passive; a local listener can stop page scrolling.
    element?.addEventListener("wheel", handleWheel, { passive: false });
    return () => element?.removeEventListener("wheel", handleWheel);
  }, []);

  // Read this in input handlers, not while rendering.
  const getRequestedValues = () => requested.current;
  return { changeValues, elementRef, getRequestedValues, inputValues };
}
