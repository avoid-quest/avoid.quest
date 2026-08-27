import { createFileRoute } from "@tanstack/react-router";
import { ImportPage } from "@/components/import-page";

export const Route = createFileRoute("/import")({
  component: Import,
  ssr: false,
});

function Import() {
  return <ImportPage />;
}
