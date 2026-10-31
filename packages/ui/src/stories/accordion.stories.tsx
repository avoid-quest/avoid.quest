import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@avoid.quest/ui/components/accordion";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  args: { multiple: false },
  component: Accordion,
  title: "Components/Accordion",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole("button", { name: "Why is there a delay?" });
    const second = canvas.getByRole("button", {
      name: "Where are settings stored?",
    });
    await userEvent.click(first);
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(second);
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await expect(second).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(second);
    await expect(second).toHaveAttribute("aria-expanded", "false");
  },
  render: (args) => (
    <Accordion {...args} className="w-96">
      <AccordionItem value="a">
        <AccordionTrigger>Why is there a delay?</AccordionTrigger>
        <AccordionContent>Streams buffer a few seconds.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="b">
        <AccordionTrigger>Where are settings stored?</AccordionTrigger>
        <AccordionContent>In this browser only.</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const Disabled: Story = {
  ...Default,
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    await Promise.all(
      within(canvasElement)
        .getAllByRole("button")
        .flatMap((trigger) => [
          expect(trigger).toBeDisabled(),
          expect(getComputedStyle(trigger).opacity).toBe("0.5"),
        ])
    );
  },
};
