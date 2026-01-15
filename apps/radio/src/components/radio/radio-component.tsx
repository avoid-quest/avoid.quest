import type { Radio } from "@avoid.quest/cacophony";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { CustomPlayer } from "./custom-player";
import { RadioSkeleton } from "./multiple/radio-skeleton";
import { RadioItemActions } from "./radio-item-actions";
import { RadioNameLink } from "./radio-name-link";

type RadioComponentProps = {
  radio?: Radio;
  onEdit?: (radio: Radio) => void;
  onDelete?: (radio: Radio) => void;
  onToggle?: (radio: Radio, enabled: boolean) => void;
  disabled?: boolean;
};

export function RadioComponent({
  radio,
  onEdit,
  onDelete,
  onToggle,
  disabled = false,
}: RadioComponentProps) {
  const settings = useLiveQuery(() => db.settings.limit(1).toArray())?.[0];

  // Use custom player when playerType is "default" and mode is "multiple"
  const useCustomPlayer =
    settings?.player.playerType === "default" &&
    settings?.player.mode === "multiple";

  return (
    <Card>
      {radio ? (
        <>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>
              <RadioNameLink radio={radio} />
            </CardTitle>
            <CardAction>
              <RadioItemActions
                disabled={disabled}
                onDelete={onDelete}
                onEdit={onEdit}
                onToggle={onToggle}
                radio={radio}
              />
            </CardAction>
          </CardHeader>
          <CardContent className="flex items-center">
            {useCustomPlayer ? (
              <CustomPlayer radio={radio} />
            ) : (
              <div className="w-full max-w-full overflow-hidden">
                <audio
                  aria-label={radio.name}
                  autoPlay={false}
                  className="w-full"
                  controls
                  preload="none"
                  src={radio.streamUrl}
                >
                  <track kind="captions" />
                </audio>
              </div>
            )}
          </CardContent>
        </>
      ) : (
        <RadioSkeleton />
      )}
    </Card>
  );
}
