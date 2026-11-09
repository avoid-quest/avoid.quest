import { AppError } from "@avoid.quest/error";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { RootErrorView } from "@/components/root/root-error-view";
import { viewStoryDefaults } from "@/storybook/view-story";

const meta = {
  ...viewStoryDefaults,
  args: {
    error: new Error("Storybook: an unexpected failure"),
    reset: fn(),
  },
  component: RootErrorView,
  parameters: {
    ...viewStoryDefaults.parameters,
    controls: { exclude: ["error", "info", "reset"] },
  },
  title: "Radio/Views/RootError",
} satisfies Meta<typeof RootErrorView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** An unknown error keeps its details private behind a generic message. */
export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("heading", { name: "Something went wrong" })
    ).toBeVisible();
    await expect(
      canvas.getByText("An unexpected error stopped this page.")
    ).toBeVisible();
    await expect(
      canvas.queryByText("Storybook: an unexpected failure")
    ).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(args.reset).toHaveBeenCalledOnce();
    await expect(canvas.getByRole("link", { name: "Go home" })).toHaveAttribute(
      "href",
      "/"
    );
  },
};

/** An app error shows the message written for listeners. */
export const SafeMessage: Story = {
  args: {
    error: new AppError({
      category: "network",
      code: "STORYBOOK_OFFLINE",
      safeMessage: "Radio couldn't reach the network.",
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(
        "Radio couldn't reach the network."
      )
    ).toBeVisible();
  },
};
