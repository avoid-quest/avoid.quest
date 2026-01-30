# shared

Shared utilities and feature flags for the workspace.

## Features

### Date Utilities

```typescript
import { 
  now, 
  formatTimestampForLog, 
  millisecondsToSeconds, 
  secondsToMilliseconds 
} from "@avoid.quest/shared";

now();                      // Current timestamp in ms
formatTimestampForLog(ts);  // Format for logging
millisecondsToSeconds(ms);  // Convert ms → s
secondsToMilliseconds(s);   // Convert s → ms
```

### Feature Flags

```typescript
import { features, isEnabled, isDisabled } from "@avoid.quest/shared";

// Check if a feature is enabled
if (isEnabled("newFeature")) {
  // New feature code
}

// Access all flags
console.log(features);
```

## Connections

- Used by all apps and packages for shared utilities
