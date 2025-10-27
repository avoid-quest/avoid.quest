"use client";

import { Button } from "@workspace/ui/components/button";

export default function Home() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4">
      <h1 className="font-bold text-2xl">Hello World</h1>
      <Button variant="outline">just a button</Button>
    </div>
  );
}
