import { Button } from "@avoid.quest/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@avoid.quest/ui/components/popover";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

const meta = {
  args: { modal: false },
  component: Popover,
  subcomponents: { PopoverContent, PopoverTrigger },
  title: "Components/Popover",
} satisfies Meta<typeof Popover>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Station details" })
    );
    const dialog = await within(document.body).findByRole("dialog", {
      name: "Station details",
    });
    await waitFor(() => expect(dialog).toBeVisible());
  },
  render: (args) => (
    <Popover {...args}>
      <PopoverTrigger asChild>
        <Button variant="outline">Station details</Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Station details">
        Independent radio from London.
      </PopoverContent>
    </Popover>
  ),
};
