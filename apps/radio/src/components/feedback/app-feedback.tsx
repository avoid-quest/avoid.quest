import { Button } from "@avoid.quest/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@avoid.quest/ui/components/dialog";
import { Input } from "@avoid.quest/ui/components/input";
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
import { createContext, useContext, useState } from "react";
import { toast } from "sonner";
import { FEEDBACK_CATEGORIES, FEEDBACK_ENDPOINT } from "@/lib/feedback/config";
import { usePlayerMode } from "@/lib/hooks/use-settings";

const feedbackCategoryLabels: Record<
  (typeof FEEDBACK_CATEGORIES)[number],
  string
> = {
  bug: "🐛 Bug report",
  idea: "💡 Feature idea",
  question: "❓ Question",
};

const feedbackCopy = {
  categoryLabel: "Type",
  messageLabel: "Message",
  sendLabel: "Send feedback",
  sendingLabel: "Sending...",
  successMessage: "Feedback sent",
  title: "Radio feedback",
  triggerLabel: "Feedback",
};

type ContactEmailContextValue = {
  readonly contactEmail: string;
  readonly setContactEmail: (email: string) => void;
};

const ContactEmailContext = createContext<ContactEmailContextValue | null>(
  null
);

function useContactEmail() {
  const context = useContext(ContactEmailContext);
  if (!context) {
    throw new Error("ContactEmailContext is missing");
  }
  return context;
}

function FeedbackTrigger({ viewModel }: FeedbackTriggerSlotProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={viewModel.copy.triggerLabel}
          className="text-muted-foreground hover:text-foreground"
          onClick={viewModel.show}
          size="icon"
          type="button"
          variant="ghost"
        >
          <MessageCircleMore className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>
        {viewModel.copy.triggerLabel}
      </TooltipContent>
    </Tooltip>
  );
}

function FeedbackDialog({ children, viewModel }: FeedbackDialogSlotProps) {
  return (
    <Dialog
      onOpenChange={(open) => (open ? viewModel.show() : viewModel.close())}
      open={viewModel.open}
    >
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
    <DialogHeader className="border-border/60 border-b pb-4">
      <DialogTitle
        className="text-center font-mono text-foreground/90 text-sm uppercase tracking-wider"
        id={viewModel.titleId}
      >
        {viewModel.copy.title}
      </DialogTitle>
    </DialogHeader>
  );
}

function FeedbackMessageField({ viewModel }: FeedbackMessageFieldSlotProps) {
  const { contactEmail, setContactEmail } = useContactEmail();

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="feedback-contact-email">Email (optional)</Label>
        <Input
          autoComplete="email"
          className="bg-background/60"
          disabled={viewModel.isSubmitting}
          id="feedback-contact-email"
          inputMode="email"
          maxLength={254}
          onChange={(event) => setContactEmail(event.target.value)}
          placeholder="you@example.com"
          type="email"
          value={contactEmail}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={viewModel.bodyId}>{viewModel.copy.messageLabel}</Label>
        <Textarea
          className="min-h-32 resize-none bg-background/60"
          disabled={viewModel.isSubmitting}
          id={viewModel.bodyId}
          onChange={(event) => viewModel.setBody(event.target.value)}
          placeholder="Describe what happened, what you expected, or what would make radio better."
          required
          value={viewModel.body}
        />
      </div>
    </>
  );
}

function FeedbackCategoryField({ viewModel }: FeedbackCategoryFieldSlotProps) {
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
    <DialogFooter className="border-border/60 border-t pt-4">
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
      type="submit"
    >
      {viewModel.isSubmitting
        ? viewModel.copy.sendingLabel
        : viewModel.copy.sendLabel}
    </Button>
  );
}

export function AppFeedback() {
  const [contactEmail, setContactEmail] = useState("");
  const mode = usePlayerMode();

  return (
    <ContactEmailContext.Provider value={{ contactEmail, setContactEmail }}>
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
        onAfterSubmit={() => {
          setContactEmail("");
          toast.success(feedbackCopy.successMessage);
        }}
        untrustedMetadata={() => {
          const email = contactEmail.trim();
          return {
            ...(email ? { contactEmail: email } : {}),
            mode,
          };
        }}
      />
    </ContactEmailContext.Provider>
  );
}
