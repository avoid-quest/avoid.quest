import { Button } from "@avoid.quest/ui/components/button";
import GitHubIcon from "@avoid.quest/ui/components/github-icon";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  component: GitHubIcon,
  title: "Components/GitHubIcon",
} satisfies Meta<typeof GitHubIcon>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Button asChild variant="outline">
        <a href="https://github.com/avoid-quest/avoid.quest">
          <GitHubIcon />
          View source
        </a>
      </Button>
      <Button asChild size="icon" variant="ghost">
        <a
          aria-label="avoid.quest on GitHub"
          href="https://github.com/avoid-quest/avoid.quest"
        >
          <GitHubIcon />
        </a>
      </Button>
    </div>
  ),
};
