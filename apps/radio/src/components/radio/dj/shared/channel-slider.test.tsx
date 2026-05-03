import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelSlider, snapChannelSliderValue } from "./channel-slider";

describe("ChannelSlider", () => {
  test("renders a default tick and larger coarse-pointer touch target", () => {
    const html = renderToStaticMarkup(
      <ChannelSlider
        defaultValue={1}
        formatValue={(value) => `${value}`}
        label="VOL"
        max={1.585}
        min={0}
        onChange={() => undefined}
        step={0.01}
        value={1}
      />
    );

    expect(html.includes("[@media(pointer:coarse)]:h-10")).toBeTrue();
    expect(html.includes('data-slot="slider-default-marker"')).toBeTrue();
    expect(html.includes("left:63.09148264984227%")).toBeTrue();
  });

  test("can fill bipolar controls from the default value outward", () => {
    const html = renderToStaticMarkup(
      <ChannelSlider
        defaultValue={0}
        fillFromDefault={true}
        formatValue={(value) => `${value}`}
        label="FILT"
        max={1}
        min={-1}
        onChange={() => undefined}
        step={0.01}
        value={0.5}
      />
    );

    expect(html.includes('data-slot="slider-default-origin-range"')).toBeTrue();
    expect(html.includes("left:50%")).toBeTrue();
    expect(html.includes("width:25%")).toBeTrue();
  });

  test("snaps values near the default", () => {
    expect(
      snapChannelSliderValue({
        defaultValue: 0,
        max: 1,
        min: -1,
        value: 0.03,
      })
    ).toBe(0);
    expect(
      snapChannelSliderValue({
        defaultValue: 0,
        max: 1,
        min: -1,
        value: 0.05,
      })
    ).toBe(0.05);
  });
});
