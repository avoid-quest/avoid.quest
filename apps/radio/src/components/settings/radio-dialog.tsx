import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@avoid.quest/ui/components/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@avoid.quest/ui/components/tabs";
import type { Radio } from "@/lib/audio";
import { RadioForm } from "./radio-form";
import { RadioFromUrlTab } from "./radio-from-url-tab";
import { RadioGardenTab } from "./radio-garden-tab";

type RadioDialogProps = {
  mode: "create" | "edit";
  radio?: Radio;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RadioDialog({
  mode,
  radio,
  open,
  onOpenChange,
}: RadioDialogProps) {
  const handleSuccess = () => {
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  const isEdit = mode === "edit";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[90vh] w-full max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {isEdit ? "Edit Radio Station" : "Add Radio Station"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the radio station details."
              : "Search Radio Garden, fetch from a URL, or enter details manually."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isEdit ? (
            <RadioForm
              mode="edit"
              onCancel={handleCancel}
              onSuccess={handleSuccess}
              radio={radio}
            />
          ) : (
            <Tabs defaultValue="radiogarden">
              <TabsList className="w-full">
                <TabsTrigger value="radiogarden">Radio Garden</TabsTrigger>
                <TabsTrigger value="from-url">From URL</TabsTrigger>
                <TabsTrigger value="manual">Manual</TabsTrigger>
              </TabsList>
              <TabsContent value="radiogarden">
                <RadioGardenTab onSuccess={handleSuccess} />
              </TabsContent>
              <TabsContent value="from-url">
                <RadioFromUrlTab onSuccess={handleSuccess} />
              </TabsContent>
              <TabsContent value="manual">
                <RadioForm
                  mode="create"
                  onCancel={handleCancel}
                  onSuccess={handleSuccess}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
