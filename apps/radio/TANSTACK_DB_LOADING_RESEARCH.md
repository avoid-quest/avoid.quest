# TanStack DB loading research

**Checked:** 2026-07-28 against the current official TanStack DB/Start docs
and the installed `@tanstack/db@0.6.9` / `@tanstack/react-db@0.1.87`
source and types.

## Finding and implementation outcome

The visible empty shell was not evidence that localStorage itself needed a more
advanced persistence adapter. The installed localStorage collection sync reads
and parses its storage key synchronously, commits the initial rows, and marks
the collection ready in the same sync call. TanStack describes this collection
as small local-only state persisted under one key and synchronized across tabs
([localStorage collection](https://tanstack.com/db/latest/docs/collections/local-storage-collection)).

The previous app bootstrap created four lazy collections, but did not initialize
default rows until `RootShell`'s post-paint effect. `Radios` simultaneously:

- discards `isLoading` / `isReady` from the radios and settings live queries;
- converts missing radios to `[]` and missing settings to the default
  `multiple` mode (historical: Node has since replaced Multiple, and an
  unknown or legacy mode now normalises through `normalizePlayerMode`); and
- wraps the lazy mode chunk in `<Suspense fallback={null}>`
  (`src/components/radio/index.tsx:52-72`).

On an empty store, TanStack DB can therefore be correctly **ready with zero
rows** before the app-specific initializer inserts defaults. Query readiness
cannot represent that later seeding step by itself.

There was an earlier blank-state source too. The root route set `ssr: false`
without a `pendingComponent`. TanStack Start
documents that the first `ssr: false` route renders its `pendingComponent` on
the server, then the router default, and renders no fallback if neither exists
([Selective SSR: fallback rendering](https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr#fallback-rendering)).
Because `ssr: false` also disables server rendering of the route component, the
shell was all the browser could show until client hydration
([Selective SSR: `ssr: false`](https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr#ssr-false)).

## Relevant TanStack DB APIs

- `collection.preload()` starts sync and resolves when the collection first
  becomes ready; concurrent calls share the promise. `stateWhenReady()` does
  the same and returns the resulting `Map`
  ([Collection API](https://tanstack.com/db/latest/docs/reference/classes/CollectionImpl#preload),
  [stateWhenReady](https://tanstack.com/db/latest/docs/reference/classes/CollectionImpl#statewhenready)).
  The existing initializers already use `stateWhenReady()` correctly.
- `startSync` defaults to `false`: sync starts on the first subscriber unless
  explicitly started on collection creation
  ([LocalStorageCollectionConfig](https://tanstack.com/db/latest/docs/reference/interfaces/LocalStorageCollectionConfig#startsync)).
  The four small local collections now use `startSync: true` to begin that read
  at collection creation. This moves sync earlier, while the route loader still
  owns default seeding and readiness.
- `useLiveQuery` exposes `status`, `isLoading`, and `isReady` for inline loading
  UI. `useLiveSuspenseQuery` suspends until the live-query collection is ready.
  The official router integration pattern is to preload in the route loader,
  then consume with `useLiveQuery`
  ([Live queries: hook choice and loader preloading](https://tanstack.com/db/latest/docs/guides/live-queries#when-to-use-which-hook)).
- The current eager sync mode is appropriate. TanStack recommends eager loading
  for small, mostly static collections and on-demand loading for much larger
  datasets; these settings/radios/session collections are small
  ([TanStack DB overview: sync modes](https://tanstack.com/db/latest/docs/overview#sync-modes)).

## Implemented startup contract

1. Put critical collection initialization in a **client route loader**
   on the first `ssr: false` route and await it before rendering the radio UI.
   This follows TanStack DB's loader/preload guidance while also including the
   app-specific default seeding that plain `preload()` does not cover. Move the
   sync-dialog result through loader data or another explicit bootstrap result;
   do not run initialization a second time in `useEffect`.
2. Configure mode-shaped Shadcn skeletons as the root route's
   `pendingComponent`. This makes the server response and hydration interval
   useful instead of empty. TanStack Router supports `pendingMs` and
   `pendingMinMs`; tune them deliberately because Start says an SSR-disabled
   fallback is held for at least `minPendingMs`
   ([Router pending UI](https://tanstack.com/router/latest/docs/guide/data-loading#showing-a-pending-component),
   [Start fallback timing](https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr#fallback-rendering)).
3. Replace the mode chunk's `fallback={null}` with single, multiple, and DJ
   layout-matched skeletons. This covers JavaScript chunk latency independently
   of DB readiness. (Multiple is gone; the skeletons are now single, node and
   DJ, and the node one's canvas part is also the fallback for the lazy React
   Flow canvas.)
4. Preserve live-query readiness in the radio/settings/session hooks. If the
   loader is not the single bootstrap gate, render the skeleton while any
   required query is not ready and render an error boundary when the status is
   `error`. `useLiveSuspenseQuery` is also valid for unconditional queries,
   but it must be paired with loader initialization: it can stop at a ready,
   empty localStorage collection before app defaults are seeded.
5. Keep `ssr: false` until the DB boundary is made genuinely isomorphic.
   TanStack DB falls back to in-memory storage when `localStorage` is absent
   ([localStorageCollectionOptions fallback](https://tanstack.com/db/latest/docs/reference/functions/localStorageCollectionOptions)),
   but server in-memory rows are not the browser's persisted rows. Enabling SSR
   naively would risk rendering the wrong persisted state; Start's documented
   `pendingComponent` path is the safe immediate improvement.

Chrome refresh measurements moved first meaningful fallback from a roughly
994 ms empty interval to the first frame. Warm usable-mode medians are now about
423 ms (single), 440 ms (multiple), and 456 ms (DJ) in the local Vite runtime.

The Multiple figure is historical: Multiple mode was removed when Node replaced
it, and it has not been re-measured. Node mode loads the `node-*.js` chunk
(`src/components/radio/node/index.tsx`, through `loadNodeRadios` in
`src/components/radio/radio-mode-loader.ts`). The canvas follows in the lazy
`node-canvas-*.js` and `vendor-xyflow-*.js` client chunks, which
`scripts/check-node-chunk.ts` keeps out of the eager and Worker bundles.
