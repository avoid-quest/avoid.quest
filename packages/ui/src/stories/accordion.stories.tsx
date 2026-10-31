import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@avoid.quest/ui/components/accordion";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  args: { collapsible: true, type: "single" },
  component: Accordion,
  title: "Components/Accordion",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
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
