import { Label } from "@avoid.quest/ui/components/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@avoid.quest/ui/components/radio-group";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

const meta = {
  component: RadioGroup,
  title: "Components/RadioGroup",
} satisfies Meta<typeof RadioGroup>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    canvas.getByRole("radio", { name: "system" }).focus();
    // Arrow keys move focus and selection together.
    await userEvent.keyboard("{ArrowDown>}");
    await waitFor(() =>
      expect(canvas.getByRole("radio", { name: "light" })).toBeChecked()
    );
    await userEvent.keyboard("{/ArrowDown}");
  },
  render: () => (
    <RadioGroup aria-label="Theme preference" defaultValue="system">
      {["system", "light", "dark"].map((value) => (
        <div className="flex items-center gap-2" key={value}>
          <RadioGroupItem id={`rg-${value}`} value={value} />
          <Label className="capitalize" htmlFor={`rg-${value}`}>
            {value}
          </Label>
        </div>
      ))}
    </RadioGroup>
  ),
};
