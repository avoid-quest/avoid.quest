#!/usr/bin/env bun
/**
 * Instagram Data Audit v2 - Focus on location, collabs, events
 * Fetching diverse profiles to analyze these specific fields
 */

const INSTAGRAM_API_BASE = "https://www.instagram.com/api/v1";
const REQUEST_TIMEOUT_MS = 15000;

// Diverse profiles likely to have location/collabs/events
const TEST_USERS = [
	"natgeo", // Travel/location heavy
	"spotify", // Music, likely collabs
	"nike", // Brand, collabs with athletes
	"gordonramsay", // Chef, restaurant locations
	"theweeknd", // Artist, events/tours
];
const POSTS_PER_USER = 10;

function getHeaders() {
	return {
		"User-Agent":
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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

interface LocationData {
	id: string;
	has_public_page: boolean;
	name: string;
	slug: string;
	address_json?: string;
}

interface CollabProducer {
	id: string;
	is_verified: boolean;
	profile_pic_url: string;
	username: string;
}

interface PostAnalysis {
	shortcode: string;
	typename: string;
	product_type?: string;
	has_location: boolean;
	location?: LocationData;
	has_collabs: boolean;
	collabs?: CollabProducer[];
	has_upcoming_event: boolean;
	has_tagged_users: boolean;
	tagged_users_count: number;
	caption_preview: string;
}

function analyzePost(node: any): PostAnalysis {
	const caption =
		node.edge_media_to_caption?.edges?.[0]?.node?.text ||
		node.caption?.text ||
		"";

	return {
		shortcode: node.shortcode || node.code,
		typename: node.__typename,
		product_type: node.product_type,
		has_location: !!node.location,
		location: node.location || undefined,
		has_collabs:
			node.coauthor_producers && node.coauthor_producers.length > 0,
		collabs: node.coauthor_producers || undefined,
		has_upcoming_event: node.has_upcoming_event || false,
		has_tagged_users:
			node.edge_media_to_tagged_user?.edges?.length > 0 || false,
		tagged_users_count: node.edge_media_to_tagged_user?.edges?.length || 0,
		caption_preview: caption.slice(0, 100) + (caption.length > 100 ? "..." : ""),
	};
}

async function main() {
	console.log("Instagram Data Audit v2");
	console.log("Focus: location, collabs, events");
	console.log(`Testing: ${TEST_USERS.join(", ")}`);
	console.log("=".repeat(80));

	const allPosts: { username: string; posts: PostAnalysis[] }[] = [];

	// Stats
	let totalPosts = 0;
	let postsWithLocation = 0;
	let postsWithCollabs = 0;
	let postsWithEvents = 0;
	let postsWithTaggedUsers = 0;

	const locationExamples: { username: string; post: PostAnalysis }[] = [];
	const collabExamples: { username: string; post: PostAnalysis }[] = [];
	const eventExamples: { username: string; post: PostAnalysis }[] = [];

	for (let i = 0; i < TEST_USERS.length; i++) {
		const username = TEST_USERS[i];

		if (i > 0) {
			console.log("[Waiting 5s...]");
			await sleep(5000);
		}

		const data = await fetchUserRaw(username);
		if (!data) continue;

		const edges = data?.data?.user?.edge_owner_to_timeline_media?.edges || [];
		const userPosts: PostAnalysis[] = [];

		for (let j = 0; j < Math.min(edges.length, POSTS_PER_USER); j++) {
			const analysis = analyzePost(edges[j].node);
			userPosts.push(analysis);
			totalPosts++;

			if (analysis.has_location) {
				postsWithLocation++;
				if (locationExamples.length < 5) {
					locationExamples.push({ username, post: analysis });
				}
			}
			if (analysis.has_collabs) {
				postsWithCollabs++;
				if (collabExamples.length < 5) {
					collabExamples.push({ username, post: analysis });
				}
			}
			if (analysis.has_upcoming_event) {
				postsWithEvents++;
				if (eventExamples.length < 5) {
					eventExamples.push({ username, post: analysis });
				}
			}
			if (analysis.has_tagged_users) {
				postsWithTaggedUsers++;
			}
		}

		allPosts.push({ username, posts: userPosts });
		console.log(
			`  ${username}: ${userPosts.length} posts, ` +
				`${userPosts.filter((p) => p.has_location).length} with location, ` +
				`${userPosts.filter((p) => p.has_collabs).length} with collabs`,
		);
	}

	// Summary
	console.log("\n" + "=".repeat(80));
	console.log("SUMMARY");
	console.log("=".repeat(80));

	console.log(`\nTotal posts analyzed: ${totalPosts}`);
	console.log(
		`Posts with LOCATION: ${postsWithLocation} (${((postsWithLocation / totalPosts) * 100).toFixed(1)}%)`,
	);
	console.log(
		`Posts with COLLABS: ${postsWithCollabs} (${((postsWithCollabs / totalPosts) * 100).toFixed(1)}%)`,
	);
	console.log(
		`Posts with EVENTS: ${postsWithEvents} (${((postsWithEvents / totalPosts) * 100).toFixed(1)}%)`,
	);
	console.log(
		`Posts with TAGGED USERS: ${postsWithTaggedUsers} (${((postsWithTaggedUsers / totalPosts) * 100).toFixed(1)}%)`,
	);

	// Location examples
	if (locationExamples.length > 0) {
		console.log("\n--- LOCATION EXAMPLES ---");
		for (const ex of locationExamples) {
			console.log(`\n@${ex.username} - ${ex.post.shortcode}`);
			console.log(`  Location: ${ex.post.location?.name}`);
			console.log(`  Slug: ${ex.post.location?.slug}`);
			console.log(`  ID: ${ex.post.location?.id}`);
			if (ex.post.location?.address_json) {
				try {
					const addr = JSON.parse(ex.post.location.address_json);
					console.log(`  Address: ${JSON.stringify(addr)}`);
				} catch {
					console.log(`  Address JSON: ${ex.post.location.address_json}`);
				}
			}
		}
	}

	// Collab examples
	if (collabExamples.length > 0) {
		console.log("\n--- COLLAB EXAMPLES ---");
		for (const ex of collabExamples) {
			console.log(`\n@${ex.username} - ${ex.post.shortcode}`);
			console.log(
				`  Collaborators: ${ex.post.collabs?.map((c) => `@${c.username}${c.is_verified ? " ✓" : ""}`).join(", ")}`,
			);
		}
	}

	// Event examples
	if (eventExamples.length > 0) {
		console.log("\n--- EVENT EXAMPLES ---");
		for (const ex of eventExamples) {
			console.log(`\n@${ex.username} - ${ex.post.shortcode}`);
			console.log(`  has_upcoming_event: ${ex.post.has_upcoming_event}`);
			console.log(`  Caption: ${ex.post.caption_preview}`);
		}
	}

	// Raw data for deeper analysis
	const outputPath = "./scripts/instagram-audit-v2-raw.json";
	await Bun.write(
		outputPath,
		JSON.stringify(
			{
				summary: {
					totalPosts,
					postsWithLocation,
					postsWithCollabs,
					postsWithEvents,
					postsWithTaggedUsers,
				},
				locationExamples,
				collabExamples,
				eventExamples,
				allPosts,
			},
			null,
			2,
		),
	);
	console.log(`\nRaw data saved to: ${outputPath}`);
}

main().catch(console.error);
