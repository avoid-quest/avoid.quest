import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { Profiler } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getPlaybackChannelMeterSource,
  setPlaybackChannelPeakLevel,
} from "@/lib/stores/playback-runtime-store";
import { installAnimationTestEnvironment } from "./animation-test-utils";
import { PeakMeter } from "./peak-meter";

describe("PeakMeter", () => {
  test("renders compact horizontal layout with reduced bar size", () => {
    const compactHtml = renderToStaticMarkup(
      <PeakMeter
        compact={true}
        left={0.8}
        orientation="horizontal"
        right={0.6}
      />
    );

    expect(compactHtml.includes("w-full flex-col gap-px")).toBeTrue();
    expect(compactHtml.includes("h-1 w-full")).toBeTrue();
    expect(compactHtml.includes("h-1.5 w-full")).toBeFalse();
  });

  test("renders default horizontal layout with standard bar size", () => {
    const defaultHtml = renderToStaticMarkup(
      <PeakMeter left={0.8} orientation="horizontal" right={0.6} />
    );

    expect(defaultHtml.includes("w-full flex-col gap-0.5")).toBeTrue();
    expect(defaultHtml.includes("h-1.5 w-full")).toBeTrue();
  });
});

describe("PeakMeter animation", () => {
  let clock: ReturnType<typeof installAnimationTestEnvironment>;
  beforeEach(() => {
    clock = installAnimationTestEnvironment();
  });
  afterEach(() => {
    cleanup();
    clock.restore();
  });

  test("a single sample paints, holds and decays without React commits", () => {
    const commits = mock(() => undefined);
    const view = render(
      <Profiler id="meter" onRender={commits}>
        <PeakMeter source={getPlaybackChannelMeterSource("meter-test")} />
      </Profiler>
    );
    const baseline = commits.mock.calls.length;
    const fill = view.container.querySelector<HTMLElement>("[data-meter-fill]");
    const peak = view.container.querySelector<HTMLElement>("[data-meter-peak]");
    act(() => {
      setPlaybackChannelPeakLevel("meter-test", { left: 0.64, right: 0.25 });
    });
    clock.advance(1000 / 60);
    expect(fill?.style.transform).not.toBe("scaleY(0)");
    const held = peak?.style.transform;
    clock.advance(100);
    expect(peak?.style.transform).toBe(held);
    clock.advance(250);
    expect(peak?.style.transform).not.toBe(held);
    for (let i = 0; i < 180; i += 1) {
      clock.advance(1000 / 60);
    }
    expect(fill?.style.transform).toBe("scaleY(0)");
    expect(peak?.style.opacity).toBe("0");
    expect(clock.frames.size).toBe(0);
    expect(commits.mock.calls.length).toBe(baseline);
  });

  test("sixty samples per second leave React idle and hidden meters schedule nothing", () => {
    const commits = mock(() => undefined);
    const source = getPlaybackChannelMeterSource("meter-60hz");
    const view = render(
      <Profiler id="meter" onRender={commits}>
        <PeakMeter source={source} />
      </Profiler>
    );
    const baseline = commits.mock.calls.length;
    for (let i = 0; i < 60; i += 1) {
      act(() => {
        setPlaybackChannelPeakLevel("meter-60hz", {
          left: (i + 1) / 100,
          right: 0,
        });
      });
      clock.advance(1000 / 60);
    }
    expect(commits.mock.calls.length).toBe(baseline);
    view.rerender(
      <Profiler id="meter" onRender={commits}>
        <PeakMeter source={source} visible={false} />
      </Profiler>
    );
    act(() => {
      setPlaybackChannelPeakLevel("meter-60hz", { left: 1, right: 1 });
    });
    expect(clock.frames.size).toBe(0);
  });
});
