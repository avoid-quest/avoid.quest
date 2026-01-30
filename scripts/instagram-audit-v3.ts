#!/usr/bin/env bun
/**
 * Instagram Data Audit v3 - Local/smaller accounts for location data
 */

const INSTAGRAM_API_BASE = "https://www.instagram.com/api/v1";
const REQUEST_TIMEOUT_MS = 15000;

// Smaller accounts, restaurants, local businesses more likely to tag locations
const TEST_USERS = [
	"visitrome", // Tourism, locations
	"roma", // City account
	"pizzeriadabafetto", // Restaurant Rome
	"romaoldman", // Random local
	"faboramensroma", // Ramen shop
];
const POSTS_PER_USER = 10;

function getHeaders() {
	return {
		"User-Agent":
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
		Accept: "*/*",
		"Accept-Language": "en-US,en;q=0.9,it;q=0.8",
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

	console.log(`\nFetching: ${username}`);

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			headers: getHeaders(),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			console.error(`ERROR: HTTP ${response.status}`);
			return null;
		}

		return await response.json();
	} catch (error) {
		clearTimeout(timeoutId);
		console.error(`ERROR: ${error}`);
		return null;
	}
}

async function main() {
	console.log("Instagram Data Audit v3 - Local accounts");
	console.log(`Testing: ${TEST_USERS.join(", ")}`);
	console.log("=".repeat(80));

	const locationExamples: any[] = [];
	const collabExamples: any[] = [];
	let totalPosts = 0;
	let postsWithLocation = 0;
	let postsWithCollabs = 0;

	for (let i = 0; i < TEST_USERS.length; i++) {
		const username = TEST_USERS[i];

		if (i > 0) {
			console.log("[Waiting 5s...]");
			await sleep(5000);
		}

		const data = await fetchUserRaw(username);
		if (!data) continue;

		const edges = data?.data?.user?.edge_owner_to_timeline_media?.edges || [];

		let userLocationCount = 0;
		let userCollabCount = 0;

		for (let j = 0; j < Math.min(edges.length, POSTS_PER_USER); j++) {
			const node = edges[j].node;
			totalPosts++;

			if (node.location) {
				postsWithLocation++;
				userLocationCount++;
				if (locationExamples.length < 10) {
					locationExamples.push({
						username,
						shortcode: node.shortcode,
						location: node.location,
					});
				}
			}

			if (node.coauthor_producers?.length > 0) {
				postsWithCollabs++;
				userCollabCount++;
				if (collabExamples.length < 5) {
					collabExamples.push({
						username,
						shortcode: node.shortcode,
						collabs: node.coauthor_producers,
					});
				}
			}
		}

		console.log(
			`  ${username}: ${Math.min(edges.length, POSTS_PER_USER)} posts, ${userLocationCount} locations, ${userCollabCount} collabs`,
		);
	}

	console.log("\n" + "=".repeat(80));
	console.log("SUMMARY");
	console.log("=".repeat(80));
	console.log(`Total: ${totalPosts} posts`);
	console.log(
		`Locations: ${postsWithLocation} (${((postsWithLocation / totalPosts) * 100).toFixed(1)}%)`,
	);
	console.log(
		`Collabs: ${postsWithCollabs} (${((postsWithCollabs / totalPosts) * 100).toFixed(1)}%)`,
	);

	if (locationExamples.length > 0) {
		console.log("\n--- LOCATION DATA STRUCTURE ---");
		for (const ex of locationExamples.slice(0, 5)) {
			console.log(`\n@${ex.username}/${ex.shortcode}:`);
			console.log(JSON.stringify(ex.location, null, 2));
		}
	} else {
		console.log("\nNo location examples found.");
	}

	if (collabExamples.length > 0) {
		console.log("\n--- COLLAB DATA STRUCTURE ---");
		for (const ex of collabExamples.slice(0, 3)) {
			console.log(`\n@${ex.username}/${ex.shortcode}:`);
			console.log(JSON.stringify(ex.collabs, null, 2));
		}
	}

	// Save raw
	await Bun.write(
		"./scripts/instagram-audit-v3-raw.json",
		JSON.stringify({ locationExamples, collabExamples }, null, 2),
	);
	console.log("\nSaved to: ./scripts/instagram-audit-v3-raw.json");
}

main().catch(console.error);
