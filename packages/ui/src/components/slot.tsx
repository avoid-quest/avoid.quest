"use client";

import { useRender } from "@base-ui/react/use-render";

/** Compose props and refs onto a custom button using Base UI's render pattern. */
function Slot({ render, ...props }: useRender.ComponentProps<"button">) {
  return useRender({ defaultTagName: "button", render, props });
}

export { Slot };
