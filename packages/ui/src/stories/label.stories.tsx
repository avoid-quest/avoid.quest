import { Input } from "@avoid.quest/ui/components/input";
import { Label } from "@avoid.quest/ui/components/label";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  component: Label,
  title: "Components/Label",
} satisfies Meta<typeof Label>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Station name"));
    await expect(
      canvas.getByRole("textbox", { name: "Station name" })
    ).toHaveFocus();
  },
  render: () => (
    <div className="grid max-w-sm gap-2">
      <Label htmlFor="label-name">Station name</Label>
      <Input id="label-name" />
    </div>
  ),
};
