import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { NowPlayingPanel } from "@/components/radio/single/single-player-now-playing";
import { FIXTURE_NOW_PLAYING, FIXTURE_STATION } from "@/storybook/fixtures";

const meta = {
  args: {
    error: null,
    isLoading: false,
    isMuted: false,
    isPlaying: false,
    onMuteToggle: fn(),
    onPlayPause: fn(),
    onVolumeChange: fn(),
    radio: FIXTURE_STATION,
    volume: 0.8,
  },
  component: NowPlayingPanel,
  decorators: [
    (Story) => (
      <div className="w-[32rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  parameters: { controls: { exclude: ["actions", "metadata", "radio"] } },
  title: "Radio/Features/NowPlayingPanel",
} satisfies Meta<typeof NowPlayingPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A station is selected and paused; nothing reports a track yet. */
export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Harbour FM")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Play" }));
    await expect(args.onPlayPause).toHaveBeenCalledOnce();
  },
};

export const Playing: Story = {
  args: { isPlaying: true, metadata: FIXTURE_NOW_PLAYING },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Low Tide")).toBeVisible();
    await expect(canvas.getByText("Lena Hart")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Pause" })).toBeVisible();
  },
};

/** Connecting can be cancelled from the transport button. */
export const Connecting: Story = {
  args: { isLoading: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Connecting…")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));
    await expect(args.onPlayPause).toHaveBeenCalledOnce();
  },
};

export const Buffering: Story = {
  args: { isBuffering: true, isPlaying: true, metadata: FIXTURE_NOW_PLAYING },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Buffering…")).toBeVisible();
  },
};

export const ErrorMessage: Story = {
  args: { error: "This stream is unavailable. Try another station." },
  name: "Error",
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("alert")).toHaveTextContent(
      "This stream is unavailable."
    );
  },
};

export const Muted: Story = {
  args: { isMuted: true, isPlaying: true },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Unmute" })
    );
    await expect(args.onMuteToggle).toHaveBeenCalledOnce();
  },
};

/** No station is selected. */
export const Empty: Story = {
  args: { radio: null },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("Nothing playing")
    ).toBeVisible();
  },
};
