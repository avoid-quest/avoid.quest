import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelSlider, snapChannelSliderValue } from "./channel-slider";

const formatValue = (value: number) => `${value}`;
const handleChange = () => undefined;

describe("ChannelSlider", () => {
  test("renders a labelled knob with the current value", () => {
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

    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-label="VOL"');
    expect(html).toContain('aria-valuenow="1"');
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

    expect(html).toContain('data-slot="knob-origin-arc"');
    expect(html).toContain('aria-valuenow="0.5"');
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
