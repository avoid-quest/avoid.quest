import { Toggle } from "@avoid.quest/ui/components/toggle";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  args: { children: "Mute" },
  component: Toggle,
  title: "Components/Toggle",
} satisfies Meta<typeof Toggle>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const toggle = within(canvasElement).getByRole("button", { name: "Mute" });
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  },
};
export const Disabled: Story = { args: { disabled: true } };
