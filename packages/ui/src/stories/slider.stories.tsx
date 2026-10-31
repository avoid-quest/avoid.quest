import { Slider } from "@avoid.quest/ui/components/slider";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  component: Slider,
  title: "Components/Slider",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
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

export const Fader: Story = {
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

export const Vertical: Story = {
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
