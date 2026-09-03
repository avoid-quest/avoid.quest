import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@avoid.quest/ui/components/accordion";
import type { ChannelSelection } from "@/lib/audio";

export function AccordionSection({
  value,
  title,
  children,
}: {
  value: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <AccordionItem
      className="rounded-lg border border-border/50 bg-muted/30"
      value={value}
    >
      <AccordionTrigger className="px-2 py-2 font-medium text-xs hover:no-underline">
        {title}
      </AccordionTrigger>
      <AccordionContent className="px-2 pb-2">{children}</AccordionContent>
    </AccordionItem>
  );
}

type ChannelOption = {
  key: string;
  label: string;
  selection: ChannelSelection;
};

export function serializeSelection(s: ChannelSelection): string {
  return `${s.left}:${s.right}`;
}

export function deserializeSelection(key: string): ChannelSelection {
  const [left, right] = key.split(":").map(Number);
  return { left: left ?? 0, right: right ?? 1 };
}

export function buildChannelOptions(channelCount: number): ChannelOption[] {
  const options: ChannelOption[] = [];
  for (let index = 0; index + 1 < channelCount; index += 2) {
    const selection = { left: index, right: index + 1 };
    options.push({
      key: serializeSelection(selection),
      label: `Ch ${index + 1}+${index + 2} (Stereo)`,
      selection,
    });
  }
  for (let index = 0; index < channelCount; index++) {
    const selection = { left: index, right: index };
    options.push({
      key: serializeSelection(selection),
      label: `Ch ${index + 1} (Mono)`,
      selection,
    });
  }
  return options;
}
