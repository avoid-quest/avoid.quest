import { Knob } from "@avoid.quest/ui/components/knob";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  component: KnobDemo,
  title: "Components/Knob",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
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

export const Default: Story = {
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
