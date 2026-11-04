import { Button } from "@avoid.quest/ui/components/button";
import GitHubIcon from "@avoid.quest/ui/components/github-icon";

export function LegalPage({ sourceRevision }: { sourceRevision?: string }) {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-6 py-10 text-sm">
      <nav
        aria-label="Source navigation"
        className="flex items-center justify-between"
      >
        <Button render={<a href="/" />} variant="ghost">
          Back to avoid.quest
        </Button>
        <Button
          render={
            <a
              aria-label="avoid.quest on GitHub"
              href="https://github.com/avoid-quest/avoid.quest"
              title="GitHub"
            />
          }
          size="icon"
          variant="ghost"
        >
          <GitHubIcon />
        </Button>
      </nav>

      <header className="space-y-3">
        <h1 className="font-semibold text-2xl tracking-tight">
          Source and licenses
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          Original code is MIT. Radio incorporates openDAW and is distributed
          under AGPL-3.0-or-later; its original MIT portions retain their MIT
          terms. Third-party code, fonts, and assets keep their own licenses.
        </p>
      </header>

      <ul className="space-y-1">
        {!!sourceRevision && (
          <li className="flex flex-wrap items-baseline gap-x-3">
            <Button
              className="h-auto px-0 py-1"
              render={<a download href="/legal/source.tar.gz" />}
              variant="link"
            >
              Download this version’s source
            </Button>
            <Button
              className="h-auto px-0 py-1 font-mono text-muted-foreground text-xs"
              render={
                <a
                  href={`https://github.com/avoid-quest/avoid.quest/tree/${sourceRevision}`}
                  title={`Source revision ${sourceRevision}`}
                />
              }
              variant="link"
            >
              {sourceRevision.slice(0, 8)}
            </Button>
          </li>
        )}
        {[
          ["License scopes", "/legal/LICENSING.md"],
          ["MIT license", "/legal/LICENSE"],
          ["GNU AGPL version 3", "/legal/LICENSES/AGPL-3.0-or-later.txt"],
          [
            "Third-party notices and source links",
            "/legal/THIRD_PARTY_NOTICES.md",
          ],
          ["Dependency license texts", "/legal/dependencies.txt"],
          [
            "openDAW WASM dependency licenses",
            "/legal/LICENSES/opendaw-rust-dependencies.txt",
          ],
        ].map(([label, href]) => (
          <li key={href}>
            <Button
              className="h-auto whitespace-normal px-0 py-1 text-left"
              render={<a href={href} />}
              variant="link"
            >
              {label}
            </Button>
          </li>
        ))}
      </ul>
      {!!sourceRevision && (
        <p className="text-muted-foreground text-xs leading-relaxed">
          Build instructions are included in the source archive. Third-party
          notices link to the matching upstream sources and build details.
        </p>
      )}
    </div>
  );
}
