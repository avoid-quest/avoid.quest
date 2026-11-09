import { Button } from "@avoid.quest/ui/components/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@avoid.quest/ui/components/drawer";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  component: Drawer,
  title: "Components/Drawer",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
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
