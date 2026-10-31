import { Slot } from "@avoid.quest/ui/components/slot";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

const meta = {
  component: Slot,
  title: "Components/Slot",
} satisfies Meta<typeof Slot>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { onClick: fn() },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole("button", {
      name: "Play station",
    });
    await expect(button).toHaveAttribute("data-station", "nts");
    await expect(button).toHaveClass("underline", "font-medium");
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
  render: (args) => (
    <Slot
      {...args}
      className="font-medium"
      data-station="nts"
      render={<button className="underline" type="button" />}
    >
      Play station
    </Slot>
  ),
};
