import { Button } from "@avoid.quest/ui/components/button";
import GitHubIcon from "@avoid.quest/ui/components/github-icon";

export function LegalPage({ sourceRevision }: { sourceRevision?: string }) {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-6 py-10 text-sm">
      <nav
        aria-label="Source navigation"
        className="flex items-center justify-between"
      >
        <Button asChild variant="ghost">
          <a href="/">Back to avoid.quest</a>
        </Button>
        <Button asChild size="icon" variant="ghost">
          <a
            aria-label="avoid.quest on GitHub"
            href="https://github.com/avoid-quest/avoid.quest"
            title="GitHub"
          >
            <GitHubIcon />
          </a>
        </Button>
      </nav>

      <header className="space-y-3">
        <h1 className="font-semibold text-2xl tracking-tight">
          Source and licenses
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          Original avoid.quest code is available under MIT, including for
          commercial use. Radio incorporates openDAW and is distributed as a
          combined application under AGPL-3.0-or-later. Its original MIT
          portions retain their MIT terms.
        </p>
      </header>

      {!!sourceRevision && (
        <section
          aria-labelledby="source-heading"
          className="space-y-4 rounded-lg border p-5"
        >
          <h2 className="font-medium text-base" id="source-heading">
            This version of radio
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Download the corresponding source for this build. DEVELOPMENT.md
            contains build instructions; THIRD_PARTY_NOTICES.md links to the
            matching upstream openDAW and WASM sources.
          </p>
          <Button asChild variant="outline">
            <a download href="/legal/source.tar.gz">
              Download source
            </a>
          </Button>
          <p className="break-all font-mono text-muted-foreground text-xs">
            Revision:{" "}
            <a
              className="underline underline-offset-4"
              href={`https://github.com/avoid-quest/avoid.quest/tree/${sourceRevision}`}
            >
              {sourceRevision}
            </a>
          </p>
        </section>
      )}

      <section aria-labelledby="licenses-heading" className="space-y-3">
        <h2 className="font-medium text-base" id="licenses-heading">
          License terms
        </h2>
        <p className="text-muted-foreground leading-relaxed">
          Third-party code, fonts, and assets keep their own licenses and
          attribution. These documents explain the scopes and include the
          required notices.
        </p>
        <ul className="space-y-1">
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
                asChild
                className="h-auto whitespace-normal px-0 py-1 text-left"
                variant="link"
              >
                <a href={href}>{label}</a>
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
