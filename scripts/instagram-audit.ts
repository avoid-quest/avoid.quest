#!/usr/bin/env bun
/**
 * Instagram Data Model Audit Script
 * Fetches raw Instagram API responses to analyze data structure
 */

const INSTAGRAM_API_BASE = "https://www.instagram.com/api/v1";
const REQUEST_TIMEOUT_MS = 15000;

// Test accounts - public, active users
const TEST_USERS = ["instagram", "cristiano", "leomessi"];
const POSTS_PER_USER = 5;

function getHeaders() {
	const userAgents = [
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	];

	return {
		"User-Agent": userAgents[Math.floor(Math.random() * userAgents.length)],
		Accept: "*/*",
		"Accept-Language": "en-US,en;q=0.9",
		"X-IG-App-ID": "936619743392459",
		"X-Requested-With": "XMLHttpRequest",
		"Sec-Fetch-Site": "same-origin",
		"Sec-Fetch-Mode": "cors",
		"Sec-Fetch-Dest": "empty",
		Referer: "https://www.instagram.com/",
	};
}

async function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchUserRaw(username: string) {
	const url = `${INSTAGRAM_API_BASE}/users/web_profile_info/?username=${encodeURIComponent(username)}`;

	console.log(`\n${"=".repeat(80)}`);
	console.log(`Fetching: ${username}`);
	console.log(`URL: ${url}`);
	console.log("=".repeat(80));

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			headers: getHeaders(),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			console.error(`ERROR: HTTP ${response.status} ${response.statusText}`);
			return null;
		}

		const data = await response.json();
		return data;
	} catch (error) {
		clearTimeout(timeoutId);
		console.error(`ERROR: ${error}`);
		return null;
	}
}

function analyzeUserData(username: string, data: any) {
	console.log(`\n--- User Profile Analysis: ${username} ---`);

	const user = data?.data?.user;
	if (!user) {
		console.log("No user data found");
		return;
	}

	// Profile fields
	console.log("\n[PROFILE FIELDS]");
	const profileFields = Object.keys(user).filter(
		(k) => !k.startsWith("edge_"),
	);
	console.log(`Fields: ${profileFields.join(", ")}`);

	// Edge types (media collections)
	console.log("\n[EDGE TYPES (Media Collections)]");
	const edgeFields = Object.keys(user).filter((k) => k.startsWith("edge_"));
	for (const edge of edgeFields) {
		const count = user[edge]?.count ?? user[edge]?.edges?.length ?? "?";
		console.log(`  - ${edge}: count=${count}`);
	}

	// Analyze posts structure
	const posts = user.edge_owner_to_timeline_media?.edges ?? [];
	console.log(`\n[POSTS ANALYSIS] (first ${POSTS_PER_USER} posts)`);

	const mediaTypes = new Set<string>();
	const allFields = new Set<string>();

	for (let i = 0; i < Math.min(posts.length, POSTS_PER_USER); i++) {
		const node = posts[i].node;
		console.log(`\n  Post ${i + 1}: ${node.shortcode ?? node.code}`);

		// Collect all fields
		Object.keys(node).forEach((k) => allFields.add(k));

		// Determine type
		let type = "image";
		if (node.is_video) type = "video";
		if (node.edge_sidecar_to_children) type = "carousel";
		if (node.__typename) type = node.__typename;

		mediaTypes.add(type);
		console.log(`    Type: ${type} (__typename: ${node.__typename ?? "N/A"})`);

		// Special fields
		if (node.product_type) console.log(`    product_type: ${node.product_type}`);
		if (node.clips_music_attribution_info)
			console.log(`    Has clips_music_attribution_info (Reel audio)`);
		if (node.coauthor_producers)
			console.log(`    Has coauthor_producers (collabs)`);
		if (node.pinned_for_users)
			console.log(`    pinned_for_users: ${JSON.stringify(node.pinned_for_users)}`);
		if (node.is_paid_partnership)
			console.log(`    is_paid_partnership: ${node.is_paid_partnership}`);

		// Carousel details
		if (node.edge_sidecar_to_children) {
			const items = node.edge_sidecar_to_children.edges;
			const itemTypes = items.map((e: any) =>
				e.node.is_video ? "video" : "image",
			);
			console.log(`    Carousel items: ${itemTypes.join(", ")}`);
		}
	}

	console.log("\n[MEDIA TYPES FOUND]");
	console.log(`  ${Array.from(mediaTypes).join(", ")}`);

	console.log("\n[ALL NODE FIELDS]");
	console.log(`  ${Array.from(allFields).sort().join(", ")}`);

	return { user, posts, mediaTypes, allFields };
}

async function main() {
	console.log("Instagram Data Model Audit");
	console.log(`Testing users: ${TEST_USERS.join(", ")}`);
	console.log(`Posts per user: ${POSTS_PER_USER}`);

	const results: Map<string, any> = new Map();

	for (let i = 0; i < TEST_USERS.length; i++) {
		const username = TEST_USERS[i];

		// Rate limiting between requests
		if (i > 0) {
			console.log("\n[Waiting 5s to avoid rate limiting...]");
			await sleep(5000);
		}

		const data = await fetchUserRaw(username);
		if (data) {
			results.set(username, analyzeUserData(username, data));
		}
	}

	// Summary
	console.log("\n" + "=".repeat(80));
	console.log("SUMMARY: Data Model Gaps & Observations");
	console.log("=".repeat(80));

	const allMediaTypes = new Set<string>();
	const allNodeFields = new Set<string>();

	for (const [username, result] of results) {
		if (result) {
			result.mediaTypes?.forEach((t: string) => allMediaTypes.add(t));
			result.allFields?.forEach((f: string) => allNodeFields.add(f));
		}
	}

	console.log("\n[ALL MEDIA TYPES ACROSS USERS]");
	console.log(`  ${Array.from(allMediaTypes).join(", ")}`);

	console.log("\n[ALL NODE FIELDS ACROSS USERS]");
	const sortedFields = Array.from(allNodeFields).sort();
	console.log(`  ${sortedFields.join("\n  ")}`);

	// Write raw data to file for deeper analysis
	const outputPath = "./scripts/instagram-audit-raw.json";
	const rawResults: Record<string, any> = {};
	for (const [username, result] of results) {
		rawResults[username] = result;
	}

	await Bun.write(outputPath, JSON.stringify(rawResults, null, 2));
	console.log(`\nRaw data saved to: ${outputPath}`);
}

main().catch(console.error);
