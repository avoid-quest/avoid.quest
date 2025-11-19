import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import type { Radio } from "@/lib/types";

type RadioNameLinkProps = {
  radio: Radio;
  className?: string;
  children?: React.ReactNode;
};

export function RadioNameLink({
  radio,
  className = "",
  children,
}: RadioNameLinkProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (radio.websiteUrl) {
      window.open(radio.websiteUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  if (!radio.websiteUrl) {
    return <span className={className}>{children || radio.name}</span>;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={`inline-flex items-center gap-1 transition-colors hover:text-primary ${
              isHovered ? "underline" : ""
            } ${className}`}
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            type="button"
          >
            {children || radio.name}
            <ExternalLink className="size-3 opacity-60" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Visit {radio.name} website</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
