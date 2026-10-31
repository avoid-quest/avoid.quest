import { Knob } from "@avoid.quest/ui/components/knob";
import { Slider } from "@avoid.quest/ui/components/slider";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  title: "Controls/Sliders and knobs",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Volume: Story = {
  play: async ({ canvasElement }) => {
    const thumb = within(canvasElement).getByRole("slider", { name: "Volume" });
    thumb.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(thumb).toHaveAttribute("aria-valuenow", "71");
  },
  render: () => (
    <Slider
      aria-label="Volume"
      className="w-64"
      defaultValue={[70]}
      max={100}
    />
  ),
};

export const HorizontalFader: Story = {
  render: () => (
    <Slider
      aria-label="Crossfader"
      className="w-64"
      defaultMarkerValue={50}
      defaultValue={[50]}
      max={100}
      snapToDefault
      variant="fader"
    />
  ),
};

export const VerticalFaders: Story = {
  render: () => (
    <div className="flex h-64 gap-8">
      <Slider
        aria-label="Channel A"
        defaultValue={[80]}
        max={100}
        orientation="vertical"
        variant="fader"
      />
      <Slider
        aria-label="Master"
        defaultValue={[100]}
        max={100}
        orientation="vertical"
        size="lg"
        variant="fader"
      />
      <Slider
        aria-label="Pan"
        defaultValue={[0]}
        max={1}
        min={-1}
        orientation="vertical"
        rangeOriginValue={0}
        step={0.01}
      />
    </div>
  ),
};

function KnobDemo({ bipolar = false }: { bipolar?: boolean }) {
  const [value, setValue] = useState(bipolar ? 0 : 0.5);
  return (
    <Knob
      ariaLabel={bipolar ? "Pan" : "Filter"}
      bipolar={bipolar}
      defaultValue={bipolar ? 0 : 0.5}
      label={bipolar ? "PAN" : "FILT"}
      max={1}
      min={bipolar ? -1 : 0}
      onChange={setValue}
      value={value}
    />
  );
}

export const Knobs: Story = {
  play: async ({ canvasElement }) => {
    const knob = within(canvasElement).getByRole("slider", { name: "Filter" });
    knob.focus();
    await userEvent.keyboard("{ArrowUp}");
    await expect(Number(knob.getAttribute("aria-valuenow"))).toBeGreaterThan(
      0.5
    );
  },
  render: () => (
    <div className="flex items-end gap-6">
      <KnobDemo />
      <KnobDemo bipolar />
    </div>
  ),
};
