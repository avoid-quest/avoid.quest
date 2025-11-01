---
"@workspace/scraper": major
---

### 🛠️ Build System Improvements

- **Fixed cross-compilation targets**: Updated build scripts to use correct Bun target format (`bun-linux-x64`, `bun-darwin-x64`, etc.) instead of invalid targets, fixing GitHub Actions build failures
- **Reorganized build output**: All compiled executables now output to the `out/` folder for better organization and cleaner project structure
- **Fixed version retrieval**: Replaced runtime `package.json` reading with build-time constant injection using Bun's `--define` flag, resolving version command failures in compiled executables

### 📦 Changes

- Build scripts now properly read version from `package.json` and embed it at compile time
- Version command now works correctly in standalone executables without requiring access to `package.json`
- All platform-specific builds (Linux, macOS x64/ARM64, Windows) now compile successfully
