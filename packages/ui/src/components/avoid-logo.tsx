import { cn } from "@workspace/ui/lib/utils";
import type { SVGProps } from "react";

const AvoidLogo = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <svg
    className={cn(
      "fill-black stroke-black text-white dark:fill-white dark:stroke-white dark:text-black",
      className
    )}
    viewBox="0 0 200 200"
    xmlns="http://www.w3.org/2000/svg "
    {...props}
  >
    <title>avoid.quest</title>
    <circle cx={100} cy={100} r={60} />
    <path d="M40 55h120" strokeWidth={2} />
    <path d="M60 55h80" stroke={"currentColor"} strokeWidth={2} />

    <path d="M20 60h160" strokeWidth={2} />
    <path d="M50 60h100" stroke={"currentColor"} strokeWidth={2} />
  </svg>
);
export default AvoidLogo;
