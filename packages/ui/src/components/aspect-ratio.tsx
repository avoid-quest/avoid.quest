"use client";

import { Root } from "@radix-ui/react-aspect-ratio";

function AspectRatio({ ...props }: React.ComponentProps<typeof Root>) {
  return <Root data-slot="aspect-ratio" {...props} />;
}

export { AspectRatio };
