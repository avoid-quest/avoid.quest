import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { NotFoundView } from "@/components/root/root-error-view";
import { viewStoryDefaults } from "@/storybook/view-story";

const meta = {
  ...viewStoryDefaults,
  component: NotFoundView,
  title: "Radio/Views/NotFound",
} satisfies Meta<typeof NotFoundView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("heading", { name: "Page not found" })
    ).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Go home" })).toHaveAttribute(
      "href",
      "/"
    );
  },
};
