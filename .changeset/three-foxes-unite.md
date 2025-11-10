---
"@avoid.quest/cacophony": patch
---

Fixed `ended` event not being emitted when playback completes after all loops finish. The `Playback` class now properly emits the `ended` event before stopping when the loop count is exceeded, ensuring consistent event handling for natural playback completion.
