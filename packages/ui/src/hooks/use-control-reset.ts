"use client";

import { type MouseEvent, type PointerEvent, useRef } from "react";

const TAP_INTERVAL_MS = 300;
const TAP_MOVEMENT_PX = 8;

type Tap = { pointerId: number; time: number; x: number; y: number };

/** Reset gestures share the same tap detection across knobs and faders. */
export function useControlReset(reset: (() => void) | undefined) {
  const activeTap = useRef<Tap | null>(null);
  const lastTap = useRef<Tap | null>(null);

  function consume(event: MouseEvent | PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    activeTap.current = null;
    lastTap.current = null;
    reset?.();
  }

  function onPointerDown(event: PointerEvent) {
    if (!reset) {
      activeTap.current = null;
      lastTap.current = null;
      return;
    }
    if (event.button !== 0) {
      return;
    }
    if (event.ctrlKey) {
      consume(event);
      return;
    }
    if (event.pointerType !== "touch") {
      return;
    }
    if (event.isPrimary === false || activeTap.current) {
      activeTap.current = null;
      lastTap.current = null;
      return;
    }
    const previous = lastTap.current;
    lastTap.current = null;
    if (
      previous &&
      event.timeStamp - previous.time <= TAP_INTERVAL_MS &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <=
        TAP_MOVEMENT_PX
    ) {
      consume(event);
      return;
    }
    activeTap.current = {
      pointerId: event.pointerId,
      time: event.timeStamp,
      x: event.clientX,
      y: event.clientY,
    };
  }

  function onPointerMove(event: PointerEvent) {
    const tap = activeTap.current;
    if (
      tap?.pointerId === event.pointerId &&
      Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > TAP_MOVEMENT_PX
    ) {
      activeTap.current = null;
      lastTap.current = null;
    }
  }

  function onPointerUp(event: PointerEvent) {
    const tap = activeTap.current;
    if (tap?.pointerId !== event.pointerId) {
      return;
    }
    activeTap.current = null;
    if (
      event.timeStamp - tap.time <= TAP_INTERVAL_MS &&
      Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <=
        TAP_MOVEMENT_PX
    ) {
      lastTap.current = { ...tap, time: event.timeStamp };
    }
  }

  function onPointerCancel(event: PointerEvent) {
    if (activeTap.current?.pointerId === event.pointerId) {
      activeTap.current = null;
      lastTap.current = null;
    }
  }

  function onDoubleClick(event: MouseEvent) {
    if (reset && event.button === 0) {
      consume(event);
    }
  }

  function onContextMenu(event: MouseEvent) {
    if (reset && event.ctrlKey) {
      // macOS also dispatches a context menu for Ctrl + primary click.
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return {
    onContextMenu,
    onDoubleClick,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
