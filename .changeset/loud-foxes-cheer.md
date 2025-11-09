---
"@avoid.quest/cacophony": patch
---

Export audio context types (AudioBuffer, AudioContext, ConvolverNode, GainNode, etc.) from the main package entry point. This allows consumers to properly type Web Audio API nodes without relying on type assertions or external type imports.
