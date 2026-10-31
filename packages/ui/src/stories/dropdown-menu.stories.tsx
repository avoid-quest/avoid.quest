import { Button } from "@avoid.quest/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@avoid.quest/ui/components/dropdown-menu";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

const meta = {
  args: { modal: true },
  component: DropdownMenu,
  subcomponents: { DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger },
  title: "Components/DropdownMenu",
} satisfies Meta<typeof DropdownMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Station options" })
    );
    const item = await within(document.body).findByRole("menuitem", {
      name: "Rename…",
    });
    await waitFor(() => expect(item).toBeVisible());
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(within(document.body).queryByRole("menu")).toBeNull()
    );
  },
  render: (args) => (
    <DropdownMenu {...args}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Station options</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Rename…</DropdownMenuItem>
        <DropdownMenuItem>Move up</DropdownMenuItem>
        <DropdownMenuItem disabled>Record</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};
