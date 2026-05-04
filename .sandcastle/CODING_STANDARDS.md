# Coding Standards

These standards are for Sandcastle agents working in this repository. Follow
`AGENTS.md` first; use this file for implementation and review judgment.

## Repository Boundaries

- Preserve the Bun workspace and Turborepo structure.
- Prefer shared packages in `packages/*` over duplicating cross-app logic.
- Do not hand-edit generated files:
  - `apps/*/src/routeTree.gen.ts`
  - `apps/*/cloudflare-env.d.ts`
  - `packages/backend/convex/_generated/**`
  - `packages/backend/convex/components/*/_generated/**`
- TanStack Start route files live in `apps/*/src/routes`. Keep route source
  files there, and regenerate route trees through normal tooling.
- Keep runtime prompts, app prompts, chat prompts, and product behavior prompts
  unchanged unless the issue explicitly asks for that.

## TypeScript And API Design

- Scrutinize optional parameters carefully. Missing values are a common source
  of bugs, especially across app/package boundaries.
- Prefer explicit validators and precise types over broad casts, `any`, or
  unchecked assumptions.
- Prefer deep modules: small public interfaces that hide meaningful
  implementation depth.
- Avoid shallow pass-through modules that add names without reducing complexity.
- Accept dependencies at boundaries instead of constructing hard-to-replace
  collaborators inside core logic.
- Return values when practical. Side effects should be narrow, explicit, and
  located near the boundary that requires them.

## React And Frontend Code

- React Compiler is enabled in the Vite/TanStack React apps. Do not add
  `useMemo`, `useCallback`, or `memo` by reflex.
- Use existing component, styling, and route patterns before introducing new
  abstractions.
- Keep UI behavior accessible and deterministic. Avoid state that can race
  against repeated clicks, route changes, or async reloads.
- Do not put test files or utility files in route directories where file-based
  routing can expose them publicly.

## Convex And Server Code

- Keep Convex timestamps in milliseconds UTC.
- Keep validators explicit.
- Use `internal*` for non-public Convex functions.
- Keep shared tables/functions in the shared Convex layer and component-owned
  domains inside their owning component namespace.
- Security-sensitive server paths must fail closed. Preserve auth, session,
  rate limiting, origin and URL validation, secret checks, and admin gating
  unless the issue explicitly changes them.

## Testing

### Core Principle

Tests should verify behavior through public interfaces, not implementation
details. Code can change entirely; tests should only break when behavior
changes.

### Good Tests

Good tests exercise real code paths through public APIs and describe what the
system does.

```typescript
test("createUser makes user retrievable", async () => {
  const user = await createUser({ name: "Alice" });
  const retrieved = await getUser(user.id);

  expect(retrieved.name).toBe("Alice");
});
```

- Test behavior users or callers care about.
- Use the public API whenever possible.
- Prefer one logical assertion per test.
- Keep tests resilient to internal refactors.

### Bad Tests

Avoid tests that only prove how internals are wired.

```typescript
test("checkout calls paymentService.process", async () => {
  const mockPayment = vi.mocked(paymentService.process);

  await checkout(cart);

  expect(mockPayment).toHaveBeenCalledWith(cart.total);
});
```

Red flags:

- Mocking internal collaborators owned by this repo.
- Testing private methods.
- Asserting internal call counts or call order.
- Querying storage directly when a public read API exists.
- Test names that describe implementation instead of behavior.

### Mocking

Mock at system boundaries only:

- External APIs.
- Time and randomness.
- File systems or databases when a real instance is not practical.
- Cloudflare, Discord, Convex, or browser APIs when local execution cannot
  provide the real boundary.

Do not mock this repo's own classes, hooks, or modules just to make assertions
easier. If behavior is hard to test without internal mocks, improve the
interface.

### TDD Workflow

Use vertical slices when adding or changing behavior:

```text
RED -> GREEN: test 1 -> implementation 1
RED -> GREEN: test 2 -> implementation 2
RED -> GREEN: test 3 -> implementation 3
```

Do not write a large batch of imagined tests before implementation. Each test
should respond to what the previous slice taught you. Do not refactor while
RED; get to GREEN first.

## Validation

- Use Bun workspace commands from the repo root.
- For code changes, run `bun run check` and `bun run typecheck` unless the
  issue gives a narrower valid command or the command is blocked.
- For touched apps/packages, run relevant scoped validation such as
  `bun run --filter <workspace> build` or `bun run --filter <workspace> test`.
- For Cloudflare type changes, run the affected workspace's `cf-typegen`.
- For Convex schema/API changes, regenerate Convex generated files through
  Convex tooling; if that cannot be done locally, say so.
