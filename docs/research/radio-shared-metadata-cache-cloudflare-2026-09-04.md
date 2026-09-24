# Shared radio metadata through a KV binding

> Superseded on 2026-09-24. Production KV writes exceeded the free daily limit,
> so the radio Worker now uses Cloudflare's Cache API for this expiring data.
> See [the current cache behavior](../../apps/radio/README.md#shared-radio-metadata).

Revised 2026-09-04 following the request to follow YAGNI. This replaces the earlier recommendation for a separate metadata Worker and Durable Objects. The broader product research is retained below as reference, not an implementation plan.

Use **one Workers KV namespace bound directly to the existing radio Worker**, exposed as env.RADIO_METADATA. The current server routes and provider functions perform the reads and writes. Cloudflare documents this exact cache-aside use case. [KV caching example](https://developers.cloudflare.com/kv/examples/cache-data-with-workers-kv/)

The request flow is simple:

1. Read the provider/resource key from KV.
2. On a hit, return the stored metadata.
3. On a miss, call the existing provider function, store a valid result with expirationTtl, and return it.

A binding provides direct access to storage from Worker code. Other Workers can bind to the same namespace; browsers and external clients use our existing HTTP API. Namespace IDs come from Cloudflare configuration, not invented values. [KV bindings](https://developers.cloudflare.com/kv/concepts/kv-bindings/)

## Smallest useful change

Add the binding in [the current Wrangler configuration](../../apps/radio/wrangler.jsonc). Extend [the existing metadata cache module](../../apps/radio/src/lib/metadata/cache.ts) with a small helper that accepts the KV binding, key, TTL, and retrieval function. Reuse its existing in-flight deduplication where applicable. Keep provider parsing in place.

Apply shared caching first to repeated episode/show descriptions, artwork URLs, station attributes, and directory lookup results. In [the current providers](../../apps/radio/src/lib/metadata/external-providers.ts) and [LYL retrieval](../../apps/radio/src/lib/metadata/lyl-provider.ts), those lookups are repeated as part of short live refreshes even when the episode has not changed. Caching those records reduces provider work while preserving live polling behavior.

Proposed starting TTLs, subject to the provider's policy:

| Record | TTL |
| --- | --- |
| Episode/show details and artwork URLs | 6 hours |
| Station attributes | 24 hours |
| Directory search results | 10 minutes |

Use a stable provider/resource ID for episode details and include query/filter/page options for searches. Cache shared public data only. Keep request IDs, cookies, and caller-specific fields in the existing route response. Retain current URL validation, rate limits, and timeout handling. An upstream failure must not be stored as a successful empty result. A cache-write failure should not discard successfully retrieved metadata.

Radio Browser currently runs from the browser. To share those results, route its lookup through the existing radio Worker and wrap the existing package function with the same cache helper. Browser playback checks remain local. This requires no additional Worker deployment or package extraction.

## Freshness tradeoff

KV is eventually consistent. Updates and even newly created keys can take 60 seconds or longer to appear in another location. Concurrent misses can repeat a provider call. This design reduces calls; it does not promise one globally coordinated refresh. We have no established requirement that justifies adding distributed locks. [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/)

Keep the existing 15-second cache for fast now-playing data initially. Sharing live snapshots through KV would mean accepting minute-scale lag; that is a product freshness choice, not a reason to introduce more infrastructure automatically. Setting a 15-second logical deadline inside a KV value does not remove propagation delay, and may simply cause repeated refreshes. KV's minimum expirationTtl is 60 seconds. [KV writes](https://developers.cloudflare.com/kv/api/write-key-value-pairs/)

## Scope and verification

The first change consists of one KV binding, one small cache helper, and calls from existing retrieval functions. Separate services, Durable Objects, D1 imports, queues, scheduled collectors, and multiple cache layers are outside this proposal.

No code, bindings, or Cloudflare resources were changed during this revision. Local document links and whitespace were checked; git diff --check passed. Application tests and builds were skipped because this is documentation only. Namespace provisioning and deployed cache behavior remain unverified. A future implementation should use the repository's normal check/typecheck, touched-workspace tests/build, and binding type-generation commands.

<details>
<summary>Reference: the wider Cloudflare product comparison</summary>

These alternatives were researched at the user's request. They do not change the minimal KV-binding proposal above; the fit statements describe different requirements that could arise later.

| Product | Relevant behavior | Fit for this app |
| --- | --- | --- |
| Workers Cache | HTTP response cache before Worker execution, automatic tiering, request collapsing, and support for HTTP Service Bindings. | Simple shared HTTP caching, either alone or ahead of durable records. [Overview](https://developers.cloudflare.com/workers/cache/) |
| Workers Cache API, `caches.default` | Local to the current Cloudflare data center. No global replication or Tiered Cache participation. | Useful fallback or a local acceleration layer. Alone it still lets several locations fetch the same provider. [Cache behavior](https://developers.cloudflare.com/workers/reference/how-the-cache-works/) |
| CDN cache through `fetch()` and Tiered Cache | Caches outgoing HTTP subrequests; tiering reduces how many locations contact an origin. | Good for a straightforward cacheable upstream GET. Less convenient for combining several APIs and parsing POST-derived metadata. [Workers and CDN](https://developers.cloudflare.com/cache/interaction-cloudflare-products/workers/), [Tiered Cache](https://developers.cloudflare.com/cache/how-to/tiered-cache/) |
| Workers KV | Durable shared key-value storage with automatic expiry and distributed read caches. Eventually consistent. | Good for slow-changing station or programme metadata. Poor as the authoritative current-track store or refresh lock. [KV behavior](https://developers.cloudflare.com/kv/concepts/how-kv-works/) |
| SQLite Durable Objects | One globally addressed instance per object, colocated state and storage, coordination in application code. | Best when refreshes or provider budgets must be coordinated globally. Also retains the last successful result across cache eviction. [Object model](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/) |
| D1 | SQL database with a primary writer and optional global read replicas. | Choose for an owned station catalogue, search, history, joins, or administration. More work than needed for expiring response blobs. [Replication](https://developers.cloudflare.com/d1/best-practices/read-replication/) |
| R2 | Object storage with strong read-after-write consistency. | Useful for licensed artwork copies, provider snapshots, or catalogue exports. Not a refresh scheduler or automatic distributed lock. [Consistency](https://developers.cloudflare.com/r2/reference/consistency/) |
| Queues | Buffered background work with at-least-once delivery. | Add for batch enrichment, imports, or sustained refresh jobs. Consumers must tolerate duplicate delivery. [Delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/) |
| Cron Triggers | Scheduled Worker execution using minute-based cron expressions. | Suitable for daily catalogue refreshes or a small list of popular resources. Demand-driven refresh is simpler for now-playing. [Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/) |
| Workflows | Durable multistep execution with retries and sleeps. | Appropriate for long imports or several dependent enrichment stages. Excess machinery for one short metadata fetch. [Sleep and retry](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/) |
| Hyperdrive | Connection pooling and eligible SQL query caching for existing PostgreSQL and MySQL databases. | Relevant only if we have SQL access to a database. It cannot cache providers' HTTP APIs just because those APIs have a database behind them. [Supported databases](https://developers.cloudflare.com/hyperdrive/) |

These are additional options assessed against the same workload. Several become useful if the app adds imports, owned artwork, history, or live push. They are not prerequisites for shared metadata retrieval.

| Product or capability | What it actually provides | Fit for this radio app |
| --- | --- | --- |
| Durable Object alarms | One next alarm per object, programmatically scheduled. At-least-once execution, automatic exponential retries. | Best schedule for per-station now-playing refresh if proactive collection becomes useful. The same station owner can store its result, next refresh, demand deadline, and backoff. Avoid adding Queues and Workflows for this same job. [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/) |
| Cache Reserve, now part of Smart Shield | Persistent upper-tier CDN caching on R2, subject to ordinary cacheability rules. Requires at least 10 hours of freshness and `Content-Length`. | Possible for stable catalog downloads or image originals. A poor match for now-playing metadata measured in seconds or minutes. It does not provide a queryable metadata database or refresh coordination. [Cache Reserve](https://developers.cloudflare.com/cache/advanced-configuration/cache-reserve/) |
| Pipelines | Durable JSON event ingestion, SQL transforms, and exactly-once delivery into R2 JSON/Parquet or Iceberg tables. | Good future home for long-running play-history, station-health, or provider-performance events. It does not fetch station APIs on a schedule or provide a latest-value API by itself. [Pipelines](https://developers.cloudflare.com/pipelines/), [streams](https://developers.cloudflare.com/pipelines/streams/), [sinks](https://developers.cloudflare.com/pipelines/sinks/) |
| R2 Data Catalog | Managed Apache Iceberg REST catalog backed by R2, with optional automatic compaction. | Useful for analytical datasets shared with DuckDB/Spark/Snowflake. A radio station directory called a "catalog" does not need this product merely because of its name. A small operational station table belongs in D1. [Data Catalog](https://developers.cloudflare.com/r2-data-catalog/) |
| R2 SQL | Distributed analytics query engine for Iceberg tables in R2 Data Catalog. Read-only; Parquet-backed data. | Good future tool for history analysis. Poor fit for every current-track lookup or search keystroke. It cannot perform the cache upserts and refresh leases. [R2 SQL](https://developers.cloudflare.com/r2-sql/), [limitations](https://developers.cloudflare.com/r2-sql/reference/limitations-best-practices/) |
| Workers Analytics Engine | Custom high-cardinality metrics with SQL queries, sampled at scale, retained for three months. | Useful to prove provider-call reduction and track cache hits, stale age, errors, and latency by provider. Do not use a sampled analytics dataset as the current-metadata store or an exact quota counter. [Storage comparison](https://developers.cloudflare.com/workers/platform/storage-options/), [sampling](https://developers.cloudflare.com/analytics/analytics-engine/sampling/), [retention](https://developers.cloudflare.com/analytics/analytics-engine/limits/) |
| Workers Logs | Invocation and structured application logs with configurable sampling. | Start here. Log refreshes and failures, rather than dumping every provider payload. This may be enough before adding Analytics Engine. [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) |
| Workers Traces | Request spans across execution and dependencies, with separate sampling control. | Useful to locate slow provider calls and storage hops. This diagnoses latency rather than storing reusable content. [Traces](https://developers.cloudflare.com/workers/observability/traces/) |
| Vectorize | Vector similarity search with metadata filters. | Optional future semantic station discovery or recommendations. Exact IDs, names, country/language/tag filters, and deterministic ranking do not require embeddings. [Vectorize](https://developers.cloudflare.com/vectorize/get-started/intro/), [metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/) |
| AI Search | Managed natural-language retrieval, built-in storage/index, optional website or R2 sources. | Optional search product, not a conventional metadata cache. External source sync defaults to six hours, configurable down to one hour; direct uploads index immediately. These semantics are unsuitable for frequent now-playing changes. [Data sources](https://developers.cloudflare.com/ai-search/configuration/data-source/), [sync](https://developers.cloudflare.com/ai-search/configuration/indexing/syncing/), [built-in storage](https://developers.cloudflare.com/ai-search/configuration/data-source/built-in-storage/) |
| Browser Run | Hosted headless Chrome, stateless extraction endpoints, Puppeteer/Playwright sessions. | Use only for a provider that actually requires rendered browser content and allows that access. Ordinary HTTP fetching and existing parsing should remain the default. Browser automation increases both maintenance and provider traffic. [Browser Run](https://developers.cloudflare.com/browser-run/) |
| Containers | Linux processes behind Workers and Durable Objects. Local disks reset when an instance sleeps. | Escape hatch for a proven native-code or long-running collector requirement. Do not deploy Redis in Containers merely to manufacture shared temporary storage. Durable data would still need external persistence. [Container lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/), [FAQ](https://developers.cloudflare.com/containers/faq/) |
| Durable Objects WebSockets | One object can coordinate connected clients; incoming WebSockets can hibernate without disconnecting. | Possible second stage to broadcast one station update to all its listeners. The collector reduces provider calls; WebSockets reduce repeated client reads and improve update latency. Keep HTTP polling initially unless measurements justify changing transport. [WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |
| SSE over Workers streams | Standard streamed HTTP responses can stay active while clients remain connected. | A possible one-way update transport, not storage. An open event stream does not create hibernating DO WebSocket behavior. Reconnection, event versioning, and per-client streaming state would be additional code. [Invocation wall-time limits](https://developers.cloudflare.com/workers/platform/limits/), [DO lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) |
| Realtime SFU, RealtimeKit, TURN | WebRTC media/DataChannel forwarding, meeting SDKs, and network relays. | Useful for building a live call or broadcast product. Excessive infrastructure for occasional metadata JSON. These products do not replace a metadata store, collector, or API. [Realtime product comparison](https://developers.cloudflare.com/realtime/) |
| Historical Pub/Sub product | The old `/pub-sub/` documentation URL currently redirects to the documentation homepage, and the current product list does not expose a supported Pub/Sub service. | Do not build the recommendation from old MQTT/Pub/Sub launch posts. Current supported choices for this use case are DO/WebSockets for client fanout and Queues for background work. Availability beyond that was not established. [Current documentation directory](https://developers.cloudflare.com/), [current real-time application guide](https://developers.cloudflare.com/use-cases/web-apps/real-time/) |
| Images | Managed image storage/delivery or transformations of images stored elsewhere, including R2. | A real optional improvement for station logos/artwork. Store allowed originals once if durable reuse matters, offer a small fixed set of sizes, and cache delivery. Images does not replace the JSON metadata cache. [Introduction](https://developers.cloudflare.com/images/get-started/introduction/), [binding](https://developers.cloudflare.com/images/optimization/binding/) |
| Workers rate-limit binding | Fast per-location, eventually consistent counters. | Good endpoint abuse protection, not a strict global provider quota. A global provider budget must live in the coordinated refresh path. [Rate-limit semantics](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) |
| AI Gateway | Caching, routing, observability, and rate limits for AI-provider calls, including custom AI HTTPS providers. | Use if a future enrichment feature actually calls AI. Its documented provider integration is not a reason to route Radio Browser or ICY metadata through an AI gateway. [Custom providers](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/) |

</details>
