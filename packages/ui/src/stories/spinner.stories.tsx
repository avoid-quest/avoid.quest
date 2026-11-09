import { Spinner } from "@avoid.quest/ui/components/spinner";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  component: Spinner,
  title: "Components/Spinner",
} satisfies Meta<typeof Spinner>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
