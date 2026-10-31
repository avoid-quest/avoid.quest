import { Button } from "@avoid.quest/ui/components/button";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlusIcon, SettingsIcon } from "lucide-react";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  args: { children: "Button" },
  argTypes: {
    size: { control: "select", options: ["sm", "default", "lg", "icon"] },
    variant: {
      control: "select",
      options: [
        "default",
        "secondary",
        "outline",
        "ghost",
        "link",
        "destructive",
      ],
    },
  },
  component: Button,
  title: "Components/Button",
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
      <Button variant="destructive">Destructive</Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button>Default</Button>
      <Button size="lg">Large</Button>
      <Button aria-label="Settings" size="icon" variant="outline">
        <SettingsIcon />
      </Button>
      <Button size="sm" variant="outline">
        <PlusIcon />
        With icon
      </Button>
    </div>
  ),
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button");
    await expect(button).toHaveAttribute("disabled");
  },
};

export const AsLink: Story = {
  args: { asChild: true, children: <a href="#top">Rendered as an anchor</a> },
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link");
    await expect(link).toHaveAttribute("data-slot", "button");
  },
};

export const KeyboardFocus: Story = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button");
    await userEvent.tab();
    await expect(button).toHaveFocus();
  },
};
