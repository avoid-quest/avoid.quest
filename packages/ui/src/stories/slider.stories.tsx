import { Slider } from "@avoid.quest/ui/components/slider";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

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
  play: async ({ canvasElement }) => {
    const thumb = within(canvasElement).getByRole("slider", {
      name: "Crossfader",
    });
    thumb.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(thumb).toHaveAttribute("aria-valuenow", "51");
    await userEvent.dblClick(
      thumb.closest('[data-slot="slider-thumb"]') ?? thumb
    );
    await expect(thumb).toHaveAttribute("aria-valuenow", "50");
  },
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

export const Range: Story = {
  play: async ({ canvasElement }) => {
    const thumbs = within(canvasElement).getAllByRole("slider", {
      name: "Range",
    });
    const [low, high] = thumbs;
    if (!(low && high)) {
      throw new Error("Expected both range thumbs");
    }
    low.focus();
    await userEvent.keyboard("{End}");
    await expect(low).toHaveAttribute("aria-valuenow", "75");
    await expect(high).toHaveAttribute("aria-valuenow", "80");
    await userEvent.dblClick(low.closest('[data-slot="slider-thumb"]') ?? low);
    await expect(low).toHaveAttribute("aria-valuenow", "20");
    await expect(high).toHaveAttribute("aria-valuenow", "80");
  },
  render: () => (
    <Slider
      aria-label="Range"
      className="w-64"
      defaultValue={[20, 80]}
      minStepsBetweenValues={5}
    />
  ),
};

export const FocusStyles: Story = {
  render: () => (
    <Slider aria-label="Focus styles" className="w-64" defaultValue={[50]} />
  ),
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("slider", {
      name: "Focus styles",
    });
    const thumb = input.closest('[data-slot="slider-thumb"]');
    if (!thumb) {
      throw new Error("Missing slider thumb");
    }
    const initialShadow = getComputedStyle(thumb).boxShadow;
    await userEvent.click(thumb);
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.unhover(thumb);
    await waitFor(() =>
      expect(getComputedStyle(thumb).boxShadow).toBe(initialShadow)
    );
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(getComputedStyle(thumb).boxShadow).not.toBe(initialShadow)
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <Slider
      aria-label="Disabled slider"
      className="w-64"
      defaultValue={[50]}
      disabled
    />
  ),
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("slider", {
      name: "Disabled slider",
    });
    const root = input.closest('[data-slot="slider"]');
    const thumb = input.closest('[data-slot="slider-thumb"]');
    if (!(root && thumb)) {
      throw new Error("Missing slider structure");
    }
    await expect(input).toBeDisabled();
    await expect(getComputedStyle(root).opacity).toBe("0.5");
    await expect(getComputedStyle(thumb).opacity).toBe("1");
  },
};
