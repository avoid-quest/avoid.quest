import { Input } from "@avoid.quest/ui/components/input";
import { Label } from "@avoid.quest/ui/components/label";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  component: Input,
  title: "Components/Input",
} satisfies Meta<typeof Input>;
export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("textbox", {
      name: "Station name",
    });
    await userEvent.type(input, "NTS Radio");
    await expect(input).toHaveValue("NTS Radio");
  },
  render: () => (
    <div className="grid max-w-sm gap-3">
      <Label htmlFor="input-name">Station name</Label>
      <Input id="input-name" placeholder="NTS Radio" />
      <Label htmlFor="input-invalid">Invalid URL</Label>
      <Input aria-invalid defaultValue="not a url" id="input-invalid" />
      <Label htmlFor="input-disabled">Unavailable</Label>
      <Input disabled id="input-disabled" placeholder="Not available" />
    </div>
  ),
};
