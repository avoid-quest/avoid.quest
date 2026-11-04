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
import { useRef, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

const meta = {
  component: Dialog,
  title: "Components/Dialog",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
function MenuToDialog() {
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline">Station options</Button>}
        />
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => setOpen(true)}>
            Rename…
          </DropdownMenuItem>
          <DropdownMenuItem>Move up</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent ref={popupRef}>
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
      <DialogTrigger render={<Button variant="outline">Open dialog</Button>} />
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
    // Repeat with keyboard activation; closing with the close control returns focus too.
    await userEvent.keyboard("{Enter}");
    const keyboardItem = await body.findByRole("menuitem", { name: "Rename…" });
    keyboardItem.focus();
    await userEvent.keyboard("{Enter}");
    const reopened = await body.findByRole("dialog");
    await userEvent.click(
      within(reopened).getByRole("button", { name: "Close" })
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
  },
  render: () => <MenuToDialog />,
};

function NonFocusingTriggerDialog() {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input aria-label="Unrelated field" ref={inputRef} />
      <Dialog>
        <DialogTrigger
          render={
            <Button
              onMouseDown={(event) => {
                event.preventDefault();
                inputRef.current?.blur();
              }}
            />
          }
        >
          Open without focusing trigger
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Non-focusing opener</DialogTitle>
          <DialogDescription>
            Closing returns to the dialog trigger.
          </DialogDescription>
        </DialogContent>
      </Dialog>
    </>
  );
}

export const NonFocusingTrigger: Story = {
  render: () => <NonFocusingTriggerDialog />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole("textbox", { name: "Unrelated field" });
    await userEvent.click(field);
    await expect(field).toHaveFocus();
    const trigger = canvas.getByRole("button", {
      name: "Open without focusing trigger",
    });
    await userEvent.click(trigger);
    await within(document.body).findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await waitFor(() =>
      expect(within(document.body).queryByRole("dialog")).toBeNull()
    );
  },
};
