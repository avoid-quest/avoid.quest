import { Skeleton } from "@avoid.quest/ui/components/skeleton";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  component: Skeleton,
  title: "Components/Skeleton",
} satisfies Meta<typeof Skeleton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div
      aria-label="Loading station"
      className="flex items-center gap-3"
      role="status"
    >
      <Skeleton className="size-10 rounded-md" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  ),
};
