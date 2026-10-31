/** biome-ignore-all lint/performance/noJsxPropsBind: stories hold local demo state */

import { Button } from "@avoid.quest/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@avoid.quest/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@avoid.quest/ui/components/dropdown-menu";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

const meta = {
  component: Dialog,
  title: "Components/Dialog",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
function MenuToDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger  render={<Button variant="outline">Station options</Button>} />
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setOpen(true)}>
            Rename…
          </DropdownMenuItem>
          <DropdownMenuItem>Move up</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename station</DialogTitle>
            <DialogDescription>
              Pick a name listeners will see.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", {
      name: "Open dialog",
    });
    await userEvent.click(trigger);
    const dialog = await within(document.body).findByRole("dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  },
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Open dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete station?</DialogTitle>
          <DialogDescription>
            This removes it from every mode. You can add it again later.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button variant="destructive">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const OpenedFromMenu: Story = {
  play: async ({ canvasElement }) => {
    const body = within(document.body);
    const trigger = within(canvasElement).getByRole("button", {
      name: "Station options",
    });
    await userEvent.click(trigger);
    const item = await body.findByRole("menuitem", { name: "Rename…" });
    await userEvent.click(item);
    await body.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    // The dialog unmounts after its exit animation; axe runs once it is gone.
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
  },
  render: () => <MenuToDialog />,
};
