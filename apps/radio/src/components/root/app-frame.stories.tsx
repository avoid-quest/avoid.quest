import type { Meta, StoryObj } from "@storybook/react-vite";
import { Music2Icon } from "lucide-react";
import { expect, waitFor, within } from "storybook/test";
import { EmptyHint } from "@/components/radio/empty-hint";
import { AppFrame } from "@/components/root/app-frame";
import {
  seedRadioSettings,
  withRadioQueryClient,
} from "@/storybook/decorators";

const LAZY_TIMEOUT = { timeout: 10_000 };

const meta = {
  args: {
    children: (
      <EmptyHint className="m-auto" icon={<Music2Icon />}>
        Nothing playing
      </EmptyHint>
    ),
  },
  beforeEach: () => seedRadioSettings(),
  component: AppFrame,
  decorators: [withRadioQueryClient],
  parameters: {
    controls: { exclude: ["children"] },
    // The header is fixed to the viewport, so docs give each story a frame.
    docs: { story: { height: "480px", inline: false } },
    layout: "fullscreen",
  },
  title: "Radio/Shell/AppFrame",
} satisfies Meta<typeof AppFrame>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("banner")).toBeVisible();
    await expect(canvas.getByRole("main")).toHaveTextContent("Nothing playing");
    const single = await canvas.findByRole(
      "radio",
      { name: "Single" },
      LAZY_TIMEOUT
    );
    await expect(single).toHaveAttribute("aria-checked", "true");
    await expect(
      await canvas.findByRole("button", { name: "Feedback" }, LAZY_TIMEOUT)
    ).toBeVisible();
    await expect(
      await canvas.findByRole("button", { name: "What's new" }, LAZY_TIMEOUT)
    ).toBeVisible();
    await expect(
      await canvas.findByRole("button", { name: "Open settings" }, LAZY_TIMEOUT)
    ).toBeVisible();
  },
};

/** Below 640px the mode labels collapse to icons, and Feedback and What's new hide. */
export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(window.innerWidth).toBeLessThan(640));
    await expect(
      await canvas.findByRole("radio", { name: "DJ" }, LAZY_TIMEOUT)
    ).toBeVisible();
    await expect(canvas.getByText("DJ")).not.toBeVisible();
    await expect(
      await canvas.findByRole("button", { name: "Open settings" }, LAZY_TIMEOUT)
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "What's new" })
    ).toBeNull();
  },
};
