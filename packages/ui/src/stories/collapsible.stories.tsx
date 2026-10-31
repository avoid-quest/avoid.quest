import { Button } from "@avoid.quest/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@avoid.quest/ui/components/collapsible";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconChevronDown } from "@tabler/icons-react";
import { expect, userEvent, waitFor, within } from "storybook/test";

const meta = {
  component: Collapsible,
  title: "Components/Collapsible",
} satisfies Meta<typeof Collapsible>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Stream details" });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByText("MP3 · 128 kbps")).toBeVisible();
    const chevron = trigger.querySelector("svg");
    if (!chevron) {
      throw new Error("Missing panel chevron");
    }
    await waitFor(() =>
      expect(getComputedStyle(chevron).rotate).toBe("180deg")
    );
    await userEvent.keyboard(" ");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("{Enter}");
  },
  render: (args) => (
    <Collapsible {...args} className="w-72 space-y-3">
      <CollapsibleTrigger
        className="group"
        render={<Button variant="outline" />}
      >
        Stream details
        <IconChevronDown
          aria-hidden="true"
          className="size-4 transition-transform group-aria-expanded:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="rounded-md border p-3 text-sm">MP3 · 128 kbps</p>
      </CollapsibleContent>
    </Collapsible>
  ),
};

export const Disabled: Story = {
  ...Default,
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", {
      name: "Stream details",
    });
    await expect(trigger).toBeDisabled();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  },
};
