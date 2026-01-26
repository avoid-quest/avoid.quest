import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import { Label } from "@avoid.quest/ui/components/label";
import { cn } from "@avoid.quest/ui/lib/utils";
import { Check, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { DEFAULT_USERNAME } from "@/lib/const";
import { useSettings, useSetUsername } from "@/lib/hooks/use-settings";

export function UsernameField() {
  const { data: settings } = useSettings();
  const username = settings?.username ?? DEFAULT_USERNAME;
  const setUsername = useSetUsername();
  const [tempUsername, setTempUsername] = useState(username);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setTempUsername(username);
    }
  }, [username, isEditing]);

  const hasChanges = tempUsername !== username;

  const handleSave = () => {
    const usernameToSave = tempUsername.trim() || DEFAULT_USERNAME;
    setUsername(usernameToSave);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && hasChanges) {
      handleSave();
    }
    if (e.key === "Escape") {
      setTempUsername(username);
      setIsEditing(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="username">Pinterest Username</Label>
      <div className="flex gap-2">
        <Input
          className="flex-1"
          disabled={!isEditing}
          id="username"
          onChange={(e) => setTempUsername(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Default: ${DEFAULT_USERNAME}`}
          value={isEditing ? tempUsername : username}
        />
        {isEditing ? (
          <Button
            className={cn(hasChanges && "bg-primary text-primary-foreground")}
            disabled={!hasChanges}
            onClick={handleSave}
            size="icon"
            title="Save"
            variant="outline"
          >
            <Check className={cn("h-4 w-4", hasChanges && "animate-pulse")} />
          </Button>
        ) : (
          <Button
            onClick={() => setIsEditing(true)}
            size="icon"
            title="Edit"
            variant="outline"
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
