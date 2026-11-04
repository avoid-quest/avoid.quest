import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@avoid.quest/ui/components/tabs";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  component: Tabs,
  title: "Components/Tabs",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
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
