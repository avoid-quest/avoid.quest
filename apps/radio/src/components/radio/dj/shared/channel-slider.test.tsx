import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelSlider, snapChannelSliderValue } from "./channel-slider";

const formatValue = (value: number) => `${value}`;
const handleChange = () => undefined;

describe("ChannelSlider", () => {
  test("renders a default tick and larger coarse-pointer touch target", () => {
    const html = renderToStaticMarkup(
      <ChannelSlider
        defaultValue={1}
        formatValue={formatValue}
        label="VOL"
        max={1.585}
        min={0}
        onChange={handleChange}
        step={0.01}
        value={1}
      />
    );

    expect(html).toContain("[@media(pointer:coarse)]:h-10");
    expect(html).toContain('data-slot="slider-default-marker"');
    expect(html).toContain("left:63.09148264984227%");
  });

  test("can fill bipolar controls from the default value outward", () => {
    const html = renderToStaticMarkup(
      <ChannelSlider
        defaultValue={0}
        fillFromDefault
        formatValue={formatValue}
        label="FILT"
        max={1}
        min={-1}
        onChange={handleChange}
        step={0.01}
        value={0.5}
      />
    );

    expect(html).toContain('data-slot="slider-default-origin-range"');
    expect(html).toContain("left:50%");
    expect(html).toContain("width:25%");
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
