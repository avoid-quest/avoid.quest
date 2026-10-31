import { Label } from "@avoid.quest/ui/components/label";
import { Switch } from "@avoid.quest/ui/components/switch";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  component: Switch,
  title: "Components/Switch",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("switch", { name: "Disabled state off" });
    await userEvent.click(toggle);
    await expect(toggle).toBeChecked();
    await userEvent.click(
      within(canvasElement).getByText("Disabled state off")
    );
    await expect(toggle).not.toBeChecked();
  },
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Switch defaultChecked id="sw-on" />
        <Label htmlFor="sw-on">Enabled</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="sw-off" />
        <Label htmlFor="sw-off">Disabled state off</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch disabled id="sw-disabled" />
        <Label htmlFor="sw-disabled">Not available</Label>
      </div>
    </div>
  ),
};
