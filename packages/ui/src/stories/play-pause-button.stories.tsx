/** biome-ignore-all lint/performance/noJsxPropsBind: stories hold local demo state */

import { PlayPauseButton } from "@avoid.quest/ui/components/play-pause-button";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  component: Transport,
  title: "Components/PlayPauseButton",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
function Transport() {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="flex items-center gap-4">
      <PlayPauseButton
        isPlaying={playing}
        label="NTS Radio"
        onClick={() => setPlaying((value) => !value)}
      />
      <PlayPauseButton
        isLoading
        isPlaying={false}
        label="Cashmere Radio"
        onClick={() => undefined}
        size="sm"
      />
    </div>
  );
}

function CancelableTransport() {
  const [loading, setLoading] = useState(true);
  return (
    <PlayPauseButton
      allowCancelWhileLoading
      isLoading={loading}
      isPlaying={false}
      label="Cashmere Radio"
      onClick={() => setLoading(false)}
      size="sm"
    />
  );
}

export const Default: Story = { render: () => <Transport /> };

export const CancelableLoading: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cancel = canvas.getByRole("button", {
      name: "Cancel Cashmere Radio",
    });
    await expect(cancel).toBeEnabled();
    await expect(cancel).not.toHaveAttribute("aria-disabled", "true");
    await userEvent.tab();
    await expect(cancel).toHaveFocus();
    await userEvent.click(cancel);
    await expect(
      canvas.getByRole("button", { name: "Play Cashmere Radio" })
    ).toHaveFocus();
  },
  render: () => <CancelableTransport />,
};
