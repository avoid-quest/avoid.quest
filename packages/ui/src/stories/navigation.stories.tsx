import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@avoid.quest/ui/components/accordion";
import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@avoid.quest/ui/components/tabs";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

const STATIONS = Array.from({ length: 30 }, (_, i) => `Station ${i + 1}`);

const meta = {
  title: "Primitives/Navigation",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SettingsTabs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("tab", { name: "Radios" }));
    await expect(canvas.getByText("Station list")).toBeVisible();
    await userEvent.keyboard("{ArrowRight}");
    await expect(canvas.getByText("Output and delay")).toBeVisible();
  },
  render: () => (
    <Tabs className="w-80" defaultValue="general">
      <TabsList className="w-full">
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="radios">Radios</TabsTrigger>
        <TabsTrigger value="playback">Playback</TabsTrigger>
      </TabsList>
      <TabsContent value="general">General settings</TabsContent>
      <TabsContent value="radios">Station list</TabsContent>
      <TabsContent value="playback">Output and delay</TabsContent>
    </Tabs>
  ),
};

export const FaqAccordion: Story = {
  render: () => (
    <Accordion className="w-96" collapsible type="single">
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

export const ScrollingList: Story = {
  parameters: {
    a11y: {
      config: {
        // Radix ScrollArea's viewport is not focusable, so keyboard users cannot scroll it.
        // Known gap, tracked for the Base UI migration; do not copy this exemption elsewhere.
        rules: [{ enabled: false, id: "scrollable-region-focusable" }],
      },
    },
  },
  render: () => (
    <ScrollArea className="h-40 w-64 rounded-md border">
      <ul className="p-3 text-sm">
        {STATIONS.map((station) => (
          <li className="py-1" key={station}>
            {station}
          </li>
        ))}
      </ul>
    </ScrollArea>
  ),
};
