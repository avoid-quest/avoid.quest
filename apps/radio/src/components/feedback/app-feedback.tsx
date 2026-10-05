/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@avoid.quest/ui/components/dialog";
import { Label } from "@avoid.quest/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { Textarea } from "@avoid.quest/ui/components/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@avoid.quest/ui/components/tooltip";
import { cn } from "@avoid.quest/ui/lib/utils";
import {
  type FeedbackActionsSlotProps,
  type FeedbackCancelActionSlotProps,
  type FeedbackCategoryFieldSlotProps,
  type FeedbackDialogSlotProps,
  type FeedbackFormSlotProps,
  type FeedbackHeaderSlotProps,
  type FeedbackMessageFieldSlotProps,
  type FeedbackStatusOutputSlotProps,
  type FeedbackSubmitActionSlotProps,
  type FeedbackTriggerSlotProps,
  FeedbackWidget,
} from "git-feedback/react";
import { MessageCircleMore } from "lucide-react";
import { toast } from "sonner";
import {
  type FEEDBACK_CATEGORIES,
  FEEDBACK_ENDPOINT,
} from "@/lib/feedback/config";
import { usePlayerMode } from "@/lib/hooks/use-settings";

const feedbackCategoryLabels: Record<
  (typeof FEEDBACK_CATEGORIES)[number],
  string
> = {
  bug: "Bug report",
  idea: "Feature idea",
  question: "Question",
};

const feedbackCopy = {
  categoryLabel: "Type",
  messageLabel: "Message",
  sendingLabel: "Sending…",
  sendLabel: "Send feedback",
  successMessage: "Feedback sent",
  title: "Radio feedback",
  triggerLabel: "Feedback",
};

function FeedbackTrigger({ viewModel }: FeedbackTriggerSlotProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={viewModel.copy.triggerLabel}
          onClick={viewModel.show}
          size="icon"
          type="button"
          variant="ghost"
        >
          <MessageCircleMore className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {viewModel.copy.triggerLabel}
      </TooltipContent>
    </Tooltip>
  );
}

function FeedbackDialog({ children, viewModel }: FeedbackDialogSlotProps) {
  const handleOpenChange = (open: boolean) =>
    open ? viewModel.show() : viewModel.close();

  return (
    <Dialog onOpenChange={handleOpenChange} open={viewModel.open}>
      <DialogContent
        aria-describedby={viewModel.statusId}
        aria-labelledby={viewModel.titleId}
        className="gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

function FeedbackForm({ children, viewModel }: FeedbackFormSlotProps) {
  return (
    <form className="grid gap-4 p-5" onSubmit={viewModel.submit}>
      {children}
    </form>
  );
}

function FeedbackHeader({ viewModel }: FeedbackHeaderSlotProps) {
  return (
    <DialogHeader>
      <DialogTitle id={viewModel.titleId}>{viewModel.copy.title}</DialogTitle>
      <DialogDescription>
        Your feedback becomes a public GitHub issue, including your radio mode,
        app version and browser details. Don’t include email addresses, private
        links or secrets. Report security issues to info@avoid.quest instead.
      </DialogDescription>
    </DialogHeader>
  );
}

function FeedbackMessageField({ viewModel }: FeedbackMessageFieldSlotProps) {
  const handleBodyChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    viewModel.setBody(event.target.value);
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor={viewModel.bodyId}>{viewModel.copy.messageLabel}</Label>
      <Textarea
        className="min-h-32 resize-none bg-background/60"
        disabled={viewModel.isSubmitting}
        id={viewModel.bodyId}
        onChange={handleBodyChange}
        placeholder="Describe what happened, what you expected, or what would make radio better."
        required
        value={viewModel.body}
      />
    </div>
  );
}

function FeedbackCategoryField({ viewModel }: FeedbackCategoryFieldSlotProps) {
  if (viewModel.categories.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={viewModel.categoryId}>
        {viewModel.copy.categoryLabel}
      </Label>
      <Select
        disabled={viewModel.isSubmitting}
        onValueChange={viewModel.setCategory}
        value={viewModel.category}
      >
        <SelectTrigger className="w-full" id={viewModel.categoryId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {viewModel.categories.map((category) => (
            <SelectItem key={category} value={category}>
              {
                feedbackCategoryLabels[
                  category as (typeof FEEDBACK_CATEGORIES)[number]
                ]
              }
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function FeedbackStatusOutput({ viewModel }: FeedbackStatusOutputSlotProps) {
  return (
    <output
      aria-live="polite"
      className={cn(
        "min-h-5 text-sm",
        viewModel.status === "success" && "text-muted-foreground",
        viewModel.status === "error" && "text-destructive"
      )}
      id={viewModel.statusId}
    >
      {viewModel.status === "success" && viewModel.copy.successMessage}
      {viewModel.status === "error" && viewModel.error}
    </output>
  );
}

function FeedbackActions({ viewModel }: FeedbackActionsSlotProps) {
  return (
    <DialogFooter>
      <FeedbackCancelAction viewModel={viewModel} />
      <FeedbackSubmitAction viewModel={viewModel} />
    </DialogFooter>
  );
}

function FeedbackCancelAction({ viewModel }: FeedbackCancelActionSlotProps) {
  return (
    <Button
      disabled={viewModel.isSubmitting}
      onClick={viewModel.close}
      size="sm"
      type="button"
      variant="outline"
    >
      {viewModel.copy.cancelLabel}
    </Button>
  );
}

function FeedbackSubmitAction({ viewModel }: FeedbackSubmitActionSlotProps) {
  return (
    <Button
      aria-busy={viewModel.isSubmitting}
      disabled={!viewModel.canSubmit}
      size="sm"
      type="submit"
    >
      {viewModel.isSubmitting
        ? viewModel.copy.sendingLabel
        : viewModel.copy.sendLabel}
    </Button>
  );
}

export function AppFeedback() {
  const mode = usePlayerMode();
  const handleAfterSubmit = () => {
    toast.success(feedbackCopy.successMessage);
  };
  const getUntrustedMetadata = () => ({ mode });

  return (
    <FeedbackWidget
      components={{
        Actions: FeedbackActions,
        CancelAction: FeedbackCancelAction,
        CategoryField: FeedbackCategoryField,
        Dialog: FeedbackDialog,
        Form: FeedbackForm,
        Header: FeedbackHeader,
        MessageField: FeedbackMessageField,
        StatusOutput: FeedbackStatusOutput,
        SubmitAction: FeedbackSubmitAction,
        Trigger: FeedbackTrigger,
      }}
      copy={feedbackCopy}
      endpoint={FEEDBACK_ENDPOINT}
      onAfterSubmit={handleAfterSubmit}
      untrustedMetadata={getUntrustedMetadata}
    />
  );
}
