# DJ workflow load recovery, 2026-10-20

Reviewed primary sources and the installed Vite helper on 2026-10-20. Browser findings describe published compatibility information, not an all-browser runtime test.

## Finding and original failure path

The finding is confirmed for browsers that retain failed module loads and for a deployment that has removed the old chunk. Its statement that failed imports cannot be retried in any browser is outdated.

The original layer, `ui-perf/lazy-dj` at `5620082c9910d6fbb7eb83f5a09918276d9130b4`, has this path in [`mode-lifecycle-manager.ts`](../../apps/radio/src/lib/mode-lifecycle-manager.ts):

1. `switchMode` deactivates the previous mode before calling the next lifecycle's `activate`.
2. DJ activation calls `loadDj`; a rejected `loadDjWorkflow()` clears `djWorkflow` and rejects.
3. The manager sets `nextModeActivationStarted` before activation. Its catch therefore calls `rollbackModeSwitch(previousMode, "dj")`.
4. `restorePreviousMode` calls `dj.deactivate()`, whose callback calls `loadDj()` again. Cleanup therefore repeats the failed import before reactivating the previous mode.
5. A later DJ entry repeats that same source import. Clearing this application promise cannot change the browser's module map or restore a removed asset.

The original retry unit test substituted a loader that rejected once and then resolved. That verifies application-promise replacement, not recovery from a browser-cached failure. Use an always-rejecting loader to exercise the supported fallback.

## Browser behavior has changed

The old [WHATWG HTML issue #6768](https://github.com/whatwg/html/issues/6768) is closed by [HTML PR #10327](https://github.com/whatwg/html/pull/10327), merged July 15, 2026. The change removes failed fetch results from the module map: concurrent imports still share their fetch and failure, while a subsequent import can fetch again. The old blanket claim is therefore no longer the current HTML requirement.

- **Firefox:** [Mozilla's Firefox 155 developer release notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/155#javascript) say network and incorrect-MIME failures are no longer cached. They cover static and dynamic imports, windows and workers, and JavaScript, JSON, CSS, and text modules. Firefox 155 was released September 1, 2026.
- **Chromium:** [Chrome's feature entry](https://chromestatus.com/feature/5214647044145152) is linked from the [Chrome 156 release notes](https://chromestatus.com/release-notes/156), which describe repeat imports fetching after a failure. Those notes still show “Preview” and a scheduled stable release of October 20, 2026. This does not establish that every listener has received that version.
- **WebKit/Safari:** [WebKit bug #319492](https://bugs.webkit.org/show_bug.cgi?id=319492) records the implementation landing on August 19, 2026. Its October 15 follow-up reports that a failed static dependency still leaves the importing module errored, linking [bug #327747](https://bugs.webkit.org/show_bug.cgi?id=327747). An engine landing does not establish stable Safari availability; the follow-up also prevents assuming complete graph recovery.

The [MDN browser compatibility data's `http_errors_not_cached` entry](https://github.com/mdn/browser-compat-data/blob/main/javascript/operators/import.json) records Chrome **156**, Firefox **155**, and Safari **preview**. It corroborates the version boundary rather than universal retry support. Older browsers remain relevant. Even a browser that retries fetching cannot recover an old URL whose asset is still absent; fresh HTML is needed to discover the new deployment's chunk URL.

## Vite 8.3.2 behavior

[`bun.lock`](../../bun.lock) resolves Vite to **8.3.2**, matching `apps/radio/node_modules/vite/package.json`. Inspected installed `dist/node/chunks/node.js` lines 26762–26836 and the matching [Vite 8.3.2 source helper](https://github.com/vitejs/vite/blob/v8.3.2/packages/vite/src/node/plugins/importAnalysisBuild.ts#L113):

- The helper records dependency URLs in `seen` before adding preload links. It does not clear those entries on failure. CSS preloads have explicit load/error promises; script preload links do not have equivalent awaited error promises here.
- `handlePreloadError` dispatches a cancelable `vite:preloadError` event on `window`, with the original error in `event.payload`. Without cancellation it throws, so the importing lifecycle can catch the rejection.
- `preventDefault()` suppresses that throw. For `baseModule().catch(handlePreloadError)`, this can turn the failed import into a fulfilled promise with `undefined`; cancellation is not recovery.
- The helper contains no built-in reload, retry, or replacement-URL mechanism.

[Vite's load-error documentation](https://v8.vite.dev/guide/build#load-error-handling) describes the event and gives a reload example. It explains stale deployment URLs and notes that HTML cache policy matters. Its example is application code, not automatic helper behavior. The [Vite troubleshooting page](https://v8.vite.dev/guide/troubleshooting#poor-network-conditions) still says retry is impossible and links #6768. That sentence predates the merged specification and shipping Firefox change; it should not be treated as a current universal browser fact.

## Design implications

Use a conservative, explicit Reload recovery action, warning that reloading stops playback. Do not automatically reload, promise same-document Retry, or infer reliability from a browser name. This deliberately forgoes some recoverable transient retries in newer engines to provide consistent behavior for older browsers, dependency failures, and stale URLs.

Load DJ code before deactivating the current mode. Cache one successful workflow or one terminal load failure per registry. DJ cleanup must only deactivate an already-created workflow: an unloaded workflow has nothing to clean up. Keep the selected mode aligned with the active mode and surface the load failure once using the app’s existing toast pattern with a persistent, accessible message and Reload only. The warning follows the existing [`LoadFailed` UI](../../apps/radio/src/components/lazy-recovery.tsx). Handle the import rejection through the lifecycle; a global event listener that cancels every Vite error risks swallowing unrelated failures.

## Limits

No Chrome, Firefox, or Safari failure matrix was executed for this research. Stable Safari shipping and Chrome 156 rollout to individual users were not verified. Bug #327747 could not be fetched directly; the dependency-failure observation above is attributed to the October 15 comment on #319492. No production deployment, HTTP cache headers, or asset-retention configuration was inspected. A reload creates a fresh document and can discover current assets; it cannot repair an ongoing network outage or broken deployment.

## Implementation validation

- `bun run check`: 953 files checked, no errors.
- `bun run typecheck`: 6 tasks passed; Astro reported 0 errors, warnings, or hints.
- `bun run --filter @avoid.quest/radio test`: 3,456 passed, 0 failed across 246 files (301,089 assertions).
- `bun run --filter @avoid.quest/radio build`: client and server build passed, including `check:node-chunk`. Sentry sourcemap upload was disabled because its credentials were absent.
- Guard negative check: temporarily added a static import of the built DJ workflow to the built Single chunk; `check:node-chunk` rejected it. Restored the original artifact and reran the guard successfully.

Regression coverage includes an always-rejecting loader, import-free cleanup before/during/after a failed load, uninterrupted Single runtime, an untouched previous Node lifecycle, serialized transitions during preparation, ordinary post-activation rollback, one workflow per registry, deduplicated recovery messages across request paths, and startup remaining inactive. Isolated jsdom tests exercise the real manager/request layer with the selector, player renderer, and Sonner live region: the running mode stays selected and mounted, no Retry is offered, Reload calls the reload function only after a click, cross-tab settings cannot replace the actual running player after failure, and failed startup shows no active selection or DJ player.
