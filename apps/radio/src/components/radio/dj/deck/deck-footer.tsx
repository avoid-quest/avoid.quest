import { Button } from "@avoid.quest/ui/components/button";
import { FileAudioIcon, Link2Icon, XIcon } from "lucide-react";

type DeckFooterProps = {
  isFileSource?: boolean;
  onChangeUrl?: () => void;
  onClear: () => void;
  onChangeDevice?: () => void;
  isDeviceInput?: boolean;
};

export function DeckFooter({
  isFileSource = false,
  onChangeUrl,
  onClear,
  onChangeDevice,
  isDeviceInput = false,
}: DeckFooterProps) {
  const changeHandler = isDeviceInput ? onChangeDevice : onChangeUrl;
  let changeLabel = "Change source";
  if (isDeviceInput) {
    changeLabel = "Change device";
  } else if (isFileSource) {
    changeLabel = "Change file";
  }
  const ChangeIcon = isFileSource ? FileAudioIcon : Link2Icon;

  return (
    <div className="flex gap-1 border-border/50 border-t pt-1.5">
      {changeHandler ? (
        <Button
          className="h-7 flex-1 text-xs"
          onClick={changeHandler}
          size="sm"
          variant="ghost"
        >
          <ChangeIcon className="size-3.5" />
          {changeLabel}
        </Button>
      ) : null}
      <Button
        className="h-7 flex-1 text-xs hover:bg-destructive/10 hover:text-destructive"
        onClick={onClear}
        size="sm"
        title="Remove the source. Effects and channel settings stay."
        variant="ghost"
      >
        <XIcon className="size-3.5" />
        Eject
      </Button>
    </div>
  );
}
