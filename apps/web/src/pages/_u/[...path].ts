import type { APIRoute } from "astro";

export const prerender = false;

const UMAMI_HOST = "https://umami.net-work.studio";

const FORWARDED_HEADERS = [
	"Content-Type",
	"User-Agent",
	"CF-Connecting-IP",
	"x-umami-cache",
];

export const ALL: APIRoute = async ({ params, request }) => {
	const target = new URL(`${UMAMI_HOST}/${params.path}`);

	const headers = new Headers();
	for (const name of FORWARDED_HEADERS) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}

	const response = await fetch(target, {
		method: request.method,
		headers,
		body: request.method !== "GET" ? await request.arrayBuffer() : undefined,
	});

	const isScript = params.path?.endsWith(".js");

	return new Response(response.body, {
		status: response.status,
		headers: {
			"Content-Type":
				response.headers.get("Content-Type") ??
				(isScript ? "application/javascript; charset=utf-8" : "application/json"),
			"Cache-Control": isScript
				? "public, max-age=3600, s-maxage=86400"
				: "no-store",
		},
	});
};
