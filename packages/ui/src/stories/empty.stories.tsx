import { Button } from "@avoid.quest/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@avoid.quest/ui/components/empty";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { RadioIcon } from "lucide-react";

const meta = {
  component: Empty,
  title: "Components/Empty",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
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
