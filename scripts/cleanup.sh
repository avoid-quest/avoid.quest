#!/bin/bash

# Clean all build artifacts and dependencies
# Works regardless of which apps/packages exist or what frameworks they use

echo "Cleaning up..."

# Remove lockfile
rm -f bun.lock

# Remove all node_modules
find . -name "node_modules" -type d -prune -exec rm -rf {} + 2>/dev/null

# Remove build outputs and caches
find . -name ".turbo" -type d -prune -exec rm -rf {} + 2>/dev/null
find . -name ".next" -type d -prune -exec rm -rf {} + 2>/dev/null
find . -name ".open-next" -type d -prune -exec rm -rf {} + 2>/dev/null
find . -name ".tanstack" -type d -prune -exec rm -rf {} + 2>/dev/null
find . -name ".wrangler" -type d -prune -exec rm -rf {} + 2>/dev/null
find . -name "dist" -type d -prune -exec rm -rf {} + 2>/dev/null

echo "Done!"
