#!/usr/bin/env bun

/**
 * Script per analizzare caption random da Convex
 * 
 * Usage:
 *   bun analyze-captions.ts [--limit 20]
 * 
 * Environment:
 *   CONVEX_URL - Required
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "./convex/_generated/api";
import type { Doc } from "./convex/_generated/dataModel";

const DEFAULT_LIMIT = 20;

/**
 * Get Convex HTTP client
 */
function getConvexClient(): ConvexHttpClient {
  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    throw new Error("CONVEX_URL environment variable is required");
  }
  return new ConvexHttpClient(convexUrl);
}

/**
 * Format timestamp to readable date
 */
function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString("it-IT", {
    timeZone: "Europe/Rome",
    dateStyle: "full",
    timeStyle: "short",
  });
}

/**
 * Print separator
 */
function printSeparator(): void {
  console.log("=".repeat(100));
}

/**
 * Print post caption with metadata
 */
function printPostCaption(
  post: Doc<"posts">,
  index: number,
  total: number
): void {
  printSeparator();
  console.log(`\n📄 POST ${index + 1}/${total}`);
  console.log(`ID: ${post._id}`);
  console.log(`Shortcode: ${post.shortcode}`);
  console.log(`URL: ${post.url}`);
  console.log(`Timestamp: ${formatTimestamp(post.timestamp)}`);
  console.log(`Media Type: ${post.media_type}`);
  console.log(`Has Metadata: ${post.metadata_id ? "Yes" : "No"}`);
  
  console.log(`\n📝 CAPTION (${post.caption.length} caratteri):`);
  console.log("-".repeat(100));
  console.log(post.caption);
  console.log("-".repeat(100));
}

/**
 * Shuffle array in place (Fisher-Yates)
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  // Parse limit
  let limit = DEFAULT_LIMIT;
  const limitIndex = args.indexOf("--limit");
  if (limitIndex !== -1 && args[limitIndex + 1]) {
    const parsedLimit = Number.parseInt(args[limitIndex + 1], 10);
    if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
      limit = parsedLimit;
    }
  }

  // Help
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
📊 Caption Analyzer

Usage:
  bun analyze-captions.ts [--limit 20]

Options:
  --limit <n>    Number of random captions to fetch (default: ${DEFAULT_LIMIT})
  --help, -h     Show this help

Environment Variables:
  CONVEX_URL     Required for fetching posts from Convex

Examples:
  bun analyze-captions.ts
  bun analyze-captions.ts --limit 50
`);
    return;
  }

  // Get Convex client
  let client: ConvexHttpClient;
  try {
    client = getConvexClient();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to initialize Convex client: ${errorMessage}`);
    process.exit(1);
  }

  console.log(`\n🔍 Fetching posts from Convex...`);
  console.log(`📊 Will show ${limit} random captions\n`);

  try {
    // Fetch more posts than needed to have better randomization
    const fetchLimit = Math.max(limit * 3, 100);
    const allPosts = await client.query(api.posts.getPosts, {
      limit: fetchLimit,
    });

    if (allPosts.length === 0) {
      console.log("❌ No posts found in database");
      return;
    }

    console.log(`✅ Found ${allPosts.length} posts total`);

    // Shuffle and take the requested limit
    const shuffledPosts = shuffleArray(allPosts);
    const selectedPosts = shuffledPosts.slice(0, limit);

    console.log(`\n📋 Showing ${selectedPosts.length} random captions:\n`);

    // Print each caption
    selectedPosts.forEach((post, index) => {
      printPostCaption(post, index, selectedPosts.length);
    });

    printSeparator();
    console.log(`\n✅ Analysis complete! Analyzed ${selectedPosts.length} captions.\n`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error fetching posts: ${errorMessage}`);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

