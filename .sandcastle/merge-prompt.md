# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. After resolving conflicts, run bounded validation before proceeding:
   - `bun run check`
   - `bun run typecheck`
   - `bun run test`
4. If validation fails because of the merged branch, fix the issues before proceeding to the next branch
5. If root typecheck exits 137 or hangs in an unrelated workspace such as `apps/web` Astro check or another untouched app, stop that validation process and run the narrowest touched-workspace typecheck/test/build commands that prove the merged branch. Record the blocked root command and exact workspace/process in the final notes; do not keep retrying the same root typecheck

After all branches are merged, make a single commit summarizing the merge.

# CLOSE ISSUES

For each branch that was merged, close its issue using the following command:

`gh issue close <ID> --comment "Completed by Sandcastle"`

Here are all the issues:

{{ISSUES}}

Once you've merged everything you can, output <promise>COMPLETE</promise>.
