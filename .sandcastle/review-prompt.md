# TASK

Review the code changes on branch `{{SOURCE_BRANCH}}` relative to `{{TARGET_BRANCH}}`.

Improve correctness, clarity, consistency, and maintainability while preserving exact functionality.

# CONTEXT

## Branch diff

!`git diff {{TARGET_BRANCH}}...{{SOURCE_BRANCH}}`

## Commits on this branch

!`git log {{TARGET_BRANCH}}..{{SOURCE_BRANCH}} --oneline`

# REVIEW PROCESS

1. **Understand the change**: Read the diff and commits above to understand the intent.

2. **Stress-test correctness**: Look for suspicious logic, unchecked assumptions, tricky conditions, implicit type coercions, missing guards, race conditions, and edge cases. If an issue can be reproduced with a focused test, write the test and fix the bug.

3. **Analyze for improvements**: Look for opportunities to:
   - Reduce unnecessary complexity and nesting
   - Eliminate redundant code and abstractions
   - Improve readability through clear variable and function names
   - Consolidate related logic
   - Remove unnecessary comments that describe obvious code
   - Avoid nested ternary operators - prefer switch statements or if/else chains
   - Choose clarity over brevity - explicit code is often better than overly compact code

4. **Check coverage**:
   - Does the implementation match the intent? Are edge cases handled?
   - Are new/changed behaviours covered by tests?
   - Are there unsafe casts, `any` types, or unchecked assumptions?
   - Does the change introduce injection vulnerabilities, credential leaks, or other security issues?

5. **Maintain balance**: Avoid over-simplification that could:
   - Reduce code clarity or maintainability
   - Create overly clever solutions that are hard to understand
   - Combine too many concerns into single functions or components
   - Remove helpful abstractions that improve code organization
   - Make the code harder to debug or extend

6. **Apply project standards**: Follow the coding-agent instructions defined in `AGENTS.md` and the standards in `.sandcastle/CODING_STANDARDS.md`.

7. **Preserve functionality**: Never change what the code does unless fixing a confirmed defect. All original features, outputs, and intended behaviors must remain intact.

# EXECUTION

If you find improvements to make:

1. Make the changes directly on this branch
2. Add focused behavior tests for correctness fixes or newly covered edge cases when practical
3. Run validation:
   - `bun run check`
   - `bun run typecheck`
   - touched-workspace typecheck/test/build commands that cover your edits
4. Commit describing the refinements

If repo-wide typecheck fails in an unrelated untouched workspace, stop that
validation path and run only the touched-workspace checks. Record the skipped
root command and exact workspace/process in the final notes.

If the code is already correct, clean, and well-structured, do nothing.

Once complete, output <promise>COMPLETE</promise>.
