import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { RadioLoadingSkeleton } from "@/components/radio/radio-loading-skeleton";
import { viewStoryDefaults } from "@/storybook/view-story";

const meta = {
  ...viewStoryDefaults,
  args: { mode: "single", phase: "database" },
  argTypes: {
    mode: { control: "inline-radio", options: ["single", "node", "dj"] },
    phase: { control: "inline-radio", options: ["database", "mode"] },
  },
  component: RadioLoadingSkeleton,
  title: "Radio/Views/Loading",
} satisfies Meta<typeof RadioLoadingSkeleton>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The page while the station database opens, before any mode loads. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const status = within(canvasElement).getByRole("status", {
      name: "Loading single radio mode",
    });
    await expect(status).toHaveAttribute("aria-busy", "true");
    await expect(status).toHaveAttribute("data-loading-phase", "database");
  },
};

export const NodeMode: Story = {
  args: { mode: "node", phase: "mode" },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("status", {
        name: "Loading node radio mode",
      })
    ).toHaveAttribute("data-loading-phase", "mode");
  },
};

export const DjMode: Story = {
  args: { mode: "dj", phase: "mode" },
  name: "DJ Mode",
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("status", {
        name: "Loading dj radio mode",
      })
    ).toHaveAttribute("data-radio-mode", "dj");
  },
};
