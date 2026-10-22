/** biome-ignore-all lint/performance/noJsxPropsBind: stories hold local demo state; React Compiler stabilizes handlers */

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
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@avoid.quest/ui/components/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@avoid.quest/ui/components/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@avoid.quest/ui/components/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@avoid.quest/ui/components/tooltip";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

const meta = {
  title: "Primitives/Overlays",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const BasicDialog: Story = {
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

/**
 * A dialog opened from a menu item has no trigger of its own once the menu
 * closes. Focus must return to the button that opened the menu.
 */
function MenuToDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">Station options</Button>
        </DropdownMenuTrigger>
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

export const DialogFromMenuReturnsFocus: Story = {
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

export const BottomDrawer: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Open settings" })
    );
    await expect(
      await within(document.body).findByRole("dialog")
    ).toBeVisible();
  },
  render: () => (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="outline">Open settings</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Settings</DrawerTitle>
          <DrawerDescription>Stored on this device only.</DrawerDescription>
        </DrawerHeader>
        <div className="h-48 px-4" />
      </DrawerContent>
    </Drawer>
  ),
};

export const PopoverAndTooltip: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "What's new" })
    );
    const content = await within(document.body).findByText(
      "Dated entries live here."
    );
    await waitFor(() => expect(content).toBeVisible());
  },
  render: () => (
    <TooltipProvider>
      <div className="flex items-center gap-4">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">What's new</Button>
          </PopoverTrigger>
          {/* Radix popovers are dialogs without a name; consumers must label them. */}
          <PopoverContent aria-label="What's new">
            Dated entries live here.
          </PopoverContent>
        </Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button aria-label="Mute" variant="ghost">
              M
            </Button>
          </TooltipTrigger>
          <TooltipContent>Mute</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  ),
};
