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
import { formatTimestampForLog } from "./convex/lib/dateUtils";

const DEFAULT_LIMIT = 20;
const SEPARATOR_LENGTH = 100;
const FETCH_MULTIPLIER = 3;
const MIN_FETCH_LIMIT = 100;
const RADIX_DECIMAL = 10;

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
 * Print separator
 */
function printSeparator(): void {
  console.log("=".repeat(SEPARATOR_LENGTH));
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
  // Timestamp is already in milliseconds (database stores in milliseconds)
  console.log(`Timestamp: ${formatTimestampForLog(post.timestamp)}`);
  console.log(`Media Type: ${post.media_type}`);
  console.log(`Has Metadata: ${post.metadata_id ? "Yes" : "No"}`);

  console.log(`\n📝 CAPTION (${post.caption.length} caratteri):`);
  console.log("-".repeat(SEPARATOR_LENGTH));
  console.log(post.caption);
  console.log("-".repeat(SEPARATOR_LENGTH));
}

/**
 * Shuffle array in place (Fisher-Yates)
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = shuffled[i];
    if (temp !== undefined && shuffled[j] !== undefined) {
      shuffled[i] = shuffled[j];
      shuffled[j] = temp;
    }
  }
  return shuffled;
}

/**
 * Parse command line arguments and return limit
 */
function parseArgs(args: string[]): number | null {
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
    return null;
  }

  // Parse limit
  let limit = DEFAULT_LIMIT;
  const limitIndex = args.indexOf("--limit");
  if (limitIndex !== -1 && limitIndex + 1 < args.length) {
    const limitValue = args[limitIndex + 1];
    if (limitValue) {
      const parsedLimit = Number.parseInt(limitValue, RADIX_DECIMAL);
      if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
        limit = parsedLimit;
      }
    }
  }

  return limit;
}

/**
 * Fetch and process posts
 */
async function fetchAndProcessPosts(
  client: ConvexHttpClient,
  limit: number
): Promise<void> {
  console.log("\n🔍 Fetching posts from Convex...");
  console.log(`📊 Will show ${limit} random captions\n`);

  // Fetch more posts than needed to have better randomization
  const fetchLimit = Math.max(limit * FETCH_MULTIPLIER, MIN_FETCH_LIMIT);
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
  console.log(
    `\n✅ Analysis complete! Analyzed ${selectedPosts.length} captions.\n`
  );
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limit = parseArgs(args);

  if (limit === null) {
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

  try {
    await fetchAndProcessPosts(client, limit);
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
