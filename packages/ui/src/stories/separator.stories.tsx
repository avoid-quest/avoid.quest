import { Separator } from "@avoid.quest/ui/components/separator";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  component: Separator,
  title: "Components/Separator",
} satisfies Meta<typeof Separator>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  render: () => (
    <div className="w-64 space-y-3 text-sm">
      <p>Now playing</p>
      <Separator decorative={false} />
      <p>NTS Radio</p>
    </div>
  ),
};

export const Vertical: Story = {
  render: () => (
    <div className="flex h-6 items-center gap-4 text-sm">
      <span>Single</span>
      <Separator orientation="vertical" />
      <span>Node</span>
      <Separator orientation="vertical" />
      <span>DJ</span>
    </div>
  ),
};
