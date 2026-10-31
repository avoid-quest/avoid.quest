import {
  ToggleGroup,
  ToggleGroupItem,
} from "@avoid.quest/ui/components/toggle-group";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  args: {
    "aria-label": "Player mode",
    defaultValue: ["single"],
    multiple: false,
  },
  component: ToggleGroup,
  parameters: { controls: { exclude: ["defaultValue", "multiple"] } },
  subcomponents: { ToggleGroupItem },
  title: "Components/ToggleGroup",
} satisfies Meta<typeof ToggleGroup>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "DJ" }));
    await expect(canvas.getByRole("button", { name: "DJ" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(
      canvas.getByRole("button", { name: "Single" })
    ).toHaveAttribute("aria-pressed", "false");
  },
  render: (args) => (
    <ToggleGroup {...args}>
      <ToggleGroupItem value="single">Single</ToggleGroupItem>
      <ToggleGroupItem value="node">Node</ToggleGroupItem>
      <ToggleGroupItem value="dj">DJ</ToggleGroupItem>
    </ToggleGroup>
  ),
};
