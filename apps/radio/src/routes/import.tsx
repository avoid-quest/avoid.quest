import { createFileRoute } from '@tanstack/react-router'
import { ImportPage } from "@/components/import-page";

export const Route = createFileRoute('/import')({
  ssr: false,
  component: Import,
})

function Import() {
  return <ImportPage />;
}

