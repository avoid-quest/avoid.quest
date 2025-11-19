import { createFileRoute } from '@tanstack/react-router'
import { Radios } from "@/components/radio";

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <div className="flex flex-col items-center justify-center p-4">
      <Radios />
    </div>
  )
}
