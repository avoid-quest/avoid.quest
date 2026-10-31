import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@avoid.quest/ui/components/alert";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { RadioIcon, TriangleAlertIcon } from "lucide-react";

const meta = {
  args: { className: "max-w-md" },
  component: Alert,
  parameters: { controls: { exclude: ["children"] } },
  title: "Components/Alert",
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <>
        <RadioIcon />
        <AlertTitle>Stream reconnected</AlertTitle>
        <AlertDescription>
          Playback resumed from the live edge.
        </AlertDescription>
      </>
    ),
  },
};

export const Destructive: Story = {
  args: {
    children: (
      <>
        <TriangleAlertIcon />
        <AlertTitle>Microphone blocked</AlertTitle>
        <AlertDescription>
          Allow access in the browser settings.
        </AlertDescription>
      </>
    ),
    variant: "destructive",
  },
};
