export const prerender = false;

const ALLOWED_ENTRIES = new Set(["client", "server", "support"]);
const UPSTREAM_BASE_URL = "https://matrix.avoid.quest/.well-known/matrix";

export const GET = async ({
  params,
  request,
}: {
  params: { entry?: string };
  request: Request;
}) => {
  const entry = params.entry;

  if (!(entry && ALLOWED_ENTRIES.has(entry))) {
    return new Response("Not found", {
      status: 404,
    });
  }

  try {
    const upstream = await fetch(`${UPSTREAM_BASE_URL}/${entry}`, {
      headers: {
        Accept: request.headers.get("Accept") ?? "application/json",
      },
    });

    const body = await upstream.text();

    return new Response(body, {
      status: upstream.status,
      headers: {
        "Access-Control-Allow-Origin":
          upstream.headers.get("Access-Control-Allow-Origin") ?? "*",
        "Cache-Control":
          upstream.headers.get("Cache-Control") ?? "public, max-age=14400",
        "Content-Type":
          upstream.headers.get("Content-Type") ??
          "application/json; charset=utf-8",
      },
    });
  } catch {
    return new Response("Upstream Matrix well-known endpoint unavailable", {
      status: 502,
    });
  }
};
