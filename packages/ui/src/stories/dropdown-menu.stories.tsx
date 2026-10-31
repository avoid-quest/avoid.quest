/** biome-ignore-all lint/performance/noJsxPropsBind: stories hold local demo state */
import { Button } from "@avoid.quest/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@avoid.quest/ui/components/dropdown-menu";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
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
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        Station options
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Rename…</DropdownMenuItem>
        <DropdownMenuItem>Move up</DropdownMenuItem>
        <DropdownMenuItem disabled>Record</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

function CheckboxMenu() {
  const [favorite, setFavorite] = useState(false);
  const [showMeters, setShowMeters] = useState(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        Display options
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuCheckboxItem
          checked={favorite}
          onCheckedChange={setFavorite}
        >
          Favorite
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={showMeters}
          closeOnClick={false}
          onCheckedChange={setShowMeters}
        >
          Show meters
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const CheckboxCloseBehavior: Story = {
  render: () => <CheckboxMenu />,
  play: async ({ canvasElement }) => {
    const body = within(document.body);
    const trigger = within(canvasElement).getByRole("button", {
      name: "Display options",
    });
    await userEvent.click(trigger);
    await userEvent.click(
      await body.findByRole("menuitemcheckbox", { name: "Favorite" })
    );
    await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
    await userEvent.click(trigger);
    await expect(
      await body.findByRole("menuitemcheckbox", { name: "Favorite" })
    ).toHaveAttribute("aria-checked", "true");
    const meters = body.getByRole("menuitemcheckbox", { name: "Show meters" });
    await userEvent.click(meters);
    await expect(meters).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(body.getByRole("menu")).toBeVisible());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
  },
};

export const Submenu: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        More options
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Output</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>Speakers</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvasElement }) => {
    const body = within(document.body);
    const trigger = within(canvasElement).getByRole("button", {
      name: "More options",
    });
    await userEvent.click(trigger);
    const submenu = await body.findByRole("menuitem", { name: "Output" });
    submenu.focus();
    await userEvent.keyboard("{ArrowRight}");
    const speakers = await body.findByRole("menuitem", { name: "Speakers" });
    await waitFor(() => expect(speakers).toBeVisible());
    await userEvent.click(speakers);
    await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
