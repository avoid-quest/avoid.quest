import { Button } from "@avoid.quest/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@avoid.quest/ui/components/tooltip";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

const meta = {
  component: Tooltip,
  subcomponents: { TooltipContent, TooltipProvider, TooltipTrigger },
  title: "Components/Tooltip",
} satisfies Meta<typeof Tooltip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expect(
      within(canvasElement).getByRole("button", { name: "Mute" })
    ).toHaveFocus();
    const tooltip = await within(document.body).findByRole("tooltip");
    await waitFor(() => expect(tooltip).toHaveTextContent("Mute"));
  },
  render: (args) => (
    <TooltipProvider delay={0}>
      <Tooltip {...args}>
        <TooltipTrigger render={<Button aria-label="Mute" variant="ghost" />}>
          M
        </TooltipTrigger>
        <TooltipContent>Mute</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
};
