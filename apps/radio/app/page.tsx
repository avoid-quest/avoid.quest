import { Radios } from "@/components/radio";

export const dynamic = "force-static";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center p-4">
      <Radios />
    </div>
  );
}
