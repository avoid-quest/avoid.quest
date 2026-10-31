import AvoidLogo from "@avoid.quest/ui/components/avoid-logo";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  component: AvoidLogo,
  title: "Components/AvoidLogo",
} satisfies Meta<typeof AvoidLogo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <AvoidLogo className="size-8" role="img" />
      <AvoidLogo className="size-16" role="img" />
      <AvoidLogo className="size-32" role="img" />
    </div>
  ),
};
