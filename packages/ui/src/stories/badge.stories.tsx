import { Badge } from "@avoid.quest/ui/components/badge";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  args: { children: "Electronic" },
  component: Badge,
  title: "Components/Badge",
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Badge>Electronic</Badge>
      <Badge variant="secondary">+2</Badge>
      <Badge variant="outline">openDAW</Badge>
      <Badge variant="destructive">Offline</Badge>
    </div>
  ),
};
