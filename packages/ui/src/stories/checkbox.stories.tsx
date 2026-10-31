import { Checkbox } from "@avoid.quest/ui/components/checkbox";
import { Label } from "@avoid.quest/ui/components/label";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  component: Checkbox,
  title: "Components/Checkbox",
} satisfies Meta<typeof Checkbox>;
export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  play: async ({ canvasElement }) => {
    const checkbox = within(canvasElement).getByRole("checkbox", {
      name: "Show in DJ mode",
    });
    await userEvent.click(checkbox);
    await expect(checkbox).toBeChecked();
  },
  render: () => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Checkbox defaultChecked id="cb-single" />
        <Label htmlFor="cb-single">Show in Single mode</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="cb-dj" />
        <Label htmlFor="cb-dj">Show in DJ mode</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox checked="indeterminate" id="cb-mixed" />
        <Label htmlFor="cb-mixed">Some stations selected</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox disabled id="cb-disabled" />
        <Label htmlFor="cb-disabled">Not available</Label>
      </div>
    </div>
  ),
};
