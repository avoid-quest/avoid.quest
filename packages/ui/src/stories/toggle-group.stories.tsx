import {
  ToggleGroup,
  ToggleGroupItem,
} from "@avoid.quest/ui/components/toggle-group";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  args: { "aria-label": "Player mode", defaultValue: "single", type: "single" },
  component: ToggleGroup,
  parameters: { controls: { exclude: ["defaultValue", "type"] } },
  subcomponents: { ToggleGroupItem },
  title: "Components/ToggleGroup",
} satisfies Meta<typeof ToggleGroup>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("radio", { name: "DJ" }));
    await expect(canvas.getByRole("radio", { name: "DJ" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(canvas.getByRole("radio", { name: "Single" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
  },
  render: (args) => (
    <ToggleGroup {...args}>
      <ToggleGroupItem value="single">Single</ToggleGroupItem>
      <ToggleGroupItem value="node">Node</ToggleGroupItem>
      <ToggleGroupItem value="dj">DJ</ToggleGroupItem>
    </ToggleGroup>
  ),
};
