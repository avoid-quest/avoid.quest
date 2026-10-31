/** biome-ignore-all lint/performance/noAwaitInLoops: pointer interactions must complete in order */
import { Button } from "@avoid.quest/ui/components/button";
import { Toaster, toast } from "@avoid.quest/ui/components/sonner";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

function showSuccess() {
  toast.success("Station saved", {
    description: "NTS Radio is in your favorites.",
  });
}
function showError() {
  toast.error("Stream unavailable", { description: "Try another station." });
}
function showWarning() {
  toast.warning("Input is clipping");
}
function showInfo() {
  toast.info("Listening on this device");
}
function showLoading() {
  toast.loading("Connecting to the stream…");
}

const meta = {
  beforeEach: () => {
    undo.mockClear();
    toast.dismiss();
    return () => {
      toast.dismiss();
    };
  },
  component: Toaster,
  parameters: {
    docs: {
      description: {
        component:
          "Toast notifications. Render `<Toaster />` once near the app root, then call `toast()`, `toast.success()`, `toast.error()` and friends from anywhere.",
      },
    },
  },
  title: "Components/Sonner",
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement, globals }) => {
    for (const [name, message] of [
      ["Success", "Station saved"],
      ["Error", "Stream unavailable"],
      ["Warning", "Input is clipping"],
      ["Info", "Listening on this device"],
      ["Loading", "Connecting to the stream…"],
    ] as const) {
      await userEvent.click(
        within(canvasElement).getByRole("button", { name })
      );
      const notification = await within(document.body).findByText(message);
      await waitFor(() => expect(notification).toBeVisible());
    }
    await waitFor(() =>
      expect(
        canvasElement.querySelector("[data-sonner-toaster]")
      ).toHaveAttribute("data-sonner-theme", globals.theme)
    );
  },
  render: () => (
    <>
      <div className="flex flex-wrap gap-3">
        <Button onClick={showSuccess} variant="outline">
          Success
        </Button>
        <Button onClick={showError} variant="outline">
          Error
        </Button>
        <Button onClick={showWarning} variant="outline">
          Warning
        </Button>
        <Button onClick={showInfo} variant="outline">
          Info
        </Button>
        <Button onClick={showLoading} variant="outline">
          Loading
        </Button>
      </div>
      <Toaster
        closeButton
        expand
        toastOptions={{ duration: Number.POSITIVE_INFINITY }}
        visibleToasts={5}
      />
    </>
  ),
};

const undo = fn();
function showUndo() {
  toast("Station removed", {
    action: { label: "Undo", onClick: undo },
    duration: Number.POSITIVE_INFINITY,
  });
}

export const UndoAction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    await userEvent.click(
      canvas.getByRole("button", { name: "Remove station" })
    );
    await userEvent.click(await body.findByRole("button", { name: "Undo" }));
    await expect(undo).toHaveBeenCalledOnce();
    await waitFor(() => expect(body.queryByText("Station removed")).toBeNull());
    await userEvent.click(
      canvas.getByRole("button", { name: "Remove station" })
    );
    const notification = await body.findByText("Station removed");
    await waitFor(() => expect(notification).toBeVisible());
  },
  render: () => (
    <>
      <Button onClick={showUndo} variant="outline">
        Remove station
      </Button>
      <Toaster closeButton />
    </>
  ),
};
