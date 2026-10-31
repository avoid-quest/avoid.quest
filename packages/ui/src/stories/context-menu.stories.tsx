/** biome-ignore-all lint/performance/noJsxPropsBind: stories hold local demo state */
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@avoid.quest/ui/components/context-menu";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

function StationMenu() {
  const [favorite, setFavorite] = useState(false);
  const [mode, setMode] = useState("single");
  const [action, setAction] = useState("None");
  return (
    <div className="space-y-4">
      <ContextMenu>
        <ContextMenuTrigger className="flex h-32 w-72 items-center justify-center rounded-md border border-dashed text-sm">
          Right-click NTS Radio
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuLabel>NTS Radio</ContextMenuLabel>
            <ContextMenuItem onClick={() => setAction("Play")}>
              Play<ContextMenuShortcut>↵</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled>Record (unavailable)</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuCheckboxItem
              checked={favorite}
              onCheckedChange={setFavorite}
            >
              Favorite
            </ContextMenuCheckboxItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>Player mode</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuRadioGroup onValueChange={setMode} value={mode}>
                  <ContextMenuRadioItem value="single">
                    Single
                  </ContextMenuRadioItem>
                  <ContextMenuRadioItem value="dj">DJ</ContextMenuRadioItem>
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => setAction("Remove")}
              variant="destructive"
            >
              Remove station
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
      <output className="block text-sm">
        Action: {action}; Favorite: {favorite ? "yes" : "no"}; Mode: {mode}
      </output>
    </div>
  );
}

const meta = {
  component: StationMenu,
  title: "Components/ContextMenu",
} satisfies Meta<typeof StationMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    const trigger = canvas.getByText("Right-click NTS Radio");
    await userEvent.pointer({ keys: "[MouseRight]", target: trigger });
    await expect(
      await body.findByRole("menuitem", { name: "Record (unavailable)" })
    ).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(body.getByRole("menuitem", { name: "Play ↵" }));
    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "Action: Play"
    );
    await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
    // Keep a menu open for the accessibility check and visual baseline.
    await userEvent.pointer({ keys: "[MouseRight]", target: trigger });
    const menu = await body.findByRole("menu");
    await waitFor(() => expect(menu).toBeVisible());
  },
};

export const CheckboxAndSubmenu: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    const trigger = canvas.getByText("Right-click NTS Radio");
    await userEvent.pointer({ keys: "[MouseRight]", target: trigger });
    await userEvent.click(
      await body.findByRole("menuitemcheckbox", { name: "Favorite" })
    );
    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "Favorite: yes"
    );
    await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
    await userEvent.pointer({ keys: "[MouseRight]", target: trigger });
    const submenu = await body.findByRole("menuitem", { name: "Player mode" });
    submenu.focus();
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.click(
      await body.findByRole("menuitemradio", { name: "DJ" })
    );
    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "Mode: dj"
    );
    await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
    await userEvent.pointer({ keys: "[MouseRight]", target: trigger });
    await expect(
      await body.findByRole("menuitemcheckbox", { name: "Favorite" })
    ).toHaveAttribute("aria-checked", "true");
    body.getByRole("menuitem", { name: "Player mode" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(
      await body.findByRole("menuitemradio", { name: "DJ" })
    ).toHaveAttribute("aria-checked", "true");
  },
};
