---
"@avoid.quest/cacophony": patch
---

Fix TypeScript declaration file generation. The build process now properly generates `.d.ts` files by using a dedicated `tsconfig.declarations.json` configuration, resolving the "Could not find a declaration file for module '@avoid.quest/cacophony'" error in consuming packages.
