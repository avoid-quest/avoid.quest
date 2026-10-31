/** biome-ignore-all lint/performance/noJsxPropsBind: stories hold local demo state; React Compiler stabilizes handlers */

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@avoid.quest/ui/components/alert";
import { Badge } from "@avoid.quest/ui/components/badge";
import { Button } from "@avoid.quest/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@avoid.quest/ui/components/empty";
import { PlayPauseButton } from "@avoid.quest/ui/components/play-pause-button";
import { Skeleton } from "@avoid.quest/ui/components/skeleton";
import { Spinner } from "@avoid.quest/ui/components/spinner";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { RadioIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  title: "Primitives/Feedback",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Badges: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Badge>Electronic</Badge>
      <Badge variant="secondary">+2</Badge>
      <Badge variant="outline">openDAW</Badge>
      <Badge variant="destructive">Offline</Badge>
    </div>
  ),
};

export const Alerts: Story = {
  render: () => (
    <div className="flex max-w-md flex-col gap-3">
      <Alert>
        <RadioIcon />
        <AlertTitle>Stream reconnected</AlertTitle>
        <AlertDescription>
          Playback resumed from the live edge.
        </AlertDescription>
      </Alert>
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Microphone blocked</AlertTitle>
        <AlertDescription>
          Allow access in the browser settings.
        </AlertDescription>
      </Alert>
    </div>
  ),
};

export const LoadingStates: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <Spinner />
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-md" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    </div>
  ),
};

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

export const PlayPause: Story = { render: () => <Transport /> };

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

export const EmptyState: Story = {
  render: () => (
    <Empty className="max-w-sm">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <RadioIcon />
        </EmptyMedia>
        <EmptyTitle>No stations yet</EmptyTitle>
        <EmptyDescription>
          Add one from a URL or pick from Radio Garden.
        </EmptyDescription>
      </EmptyHeader>
      <Button size="sm">Add station</Button>
    </Empty>
  ),
};
