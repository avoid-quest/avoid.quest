import { Button } from "@avoid.quest/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@avoid.quest/ui/components/card";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  component: Card,
  title: "Components/Card",
} satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>NTS Radio</CardTitle>
        <CardDescription>Independent radio from London.</CardDescription>
        <CardAction>
          <Button size="sm" variant="outline">
            Follow
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-sm">Live selections from resident DJs and guests.</p>
      </CardContent>
      <CardFooter>
        <Button>Listen live</Button>
      </CardFooter>
    </Card>
  ),
};
