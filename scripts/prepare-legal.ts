import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const [, , app] = process.argv;
if (app !== "radio" && app !== "web") {
  throw new Error("Expected radio or web");
}
const appRoot = path.join(root, "apps", app);
const out = path.join(appRoot, "public/legal");
rmSync(out, { force: true, recursive: true });
mkdirSync(out, { recursive: true });

type Manifest = {
  name: string;
  version?: string;
  license?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
const visited = new Set<string>();
const notices: string[] = [];
const licensePattern = /^(licen[sc]e|copying|notice|copyright)(\.|$)/i;

function findDependency(directory: string, name: string): string | undefined {
  const candidate = path.join(directory, "node_modules", name);
  if (Bun.file(path.join(candidate, "package.json")).size > 0) {
    return candidate;
  }
  const parent = path.dirname(directory);
  return parent === directory ? undefined : findDependency(parent, name);
}

function collect(directory: string) {
  const resolved = realpathSync(directory);
  if (visited.has(resolved)) {
    return;
  }
  visited.add(resolved);
  const manifest: Manifest = JSON.parse(
    readFileSync(path.join(resolved, "package.json"), "utf8")
  );
  if (!manifest.name.startsWith("@avoid.quest/")) {
    const texts = ["*", "licenses/*", "LICENSES/*", "dist/**/LICENSE*"]
      .flatMap((pattern) => [
        ...new Bun.Glob(pattern).scanSync({ cwd: resolved, onlyFiles: true }),
      ])
      .filter((file) => licensePattern.test(path.basename(file)))
      .sort()
      .map(
        (file) => `${file}\n${readFileSync(path.join(resolved, file), "utf8")}`
      );
    if (texts.length === 0) {
      // Some packages place the license text in their README instead.
      const readme = [
        ...new Bun.Glob("[Rr][Ee][Aa][Dd][Mm][Ee]*").scanSync({
          cwd: resolved,
          onlyFiles: true,
        }),
      ];
      for (const file of readme) {
        texts.push(readFileSync(path.join(resolved, file), "utf8"));
      }
    }
    if (texts.length === 0) {
      if (manifest.name.startsWith("@ffmpeg/")) {
        texts.push(
          readFileSync(path.join(root, "LICENSES/ffmpeg-wasm.txt"), "utf8")
        );
      } else {
        throw new Error(`Missing license/README for ${manifest.name}`);
      }
    }
    notices.push(
      `${manifest.name}@${manifest.version} (${manifest.license ?? "see text"})\n${texts.join("\n\n")}`
    );
  }
  for (const name of Object.keys({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
  }).sort()) {
    const dependency = findDependency(resolved, name);
    if (dependency) {
      collect(dependency);
    } else if (manifest.dependencies?.[name]) {
      throw new Error(`Missing dependency ${name} of ${manifest.name}`);
    }
  }
}
collect(appRoot);
writeFileSync(
  path.join(out, "dependencies.txt"),
  notices.sort().join("\n\n========\n\n")
);
for (const file of [
  "LICENSE",
  "LICENSING.md",
  "THIRD_PARTY_NOTICES.md",
  ...new Bun.Glob("LICENSES/*").scanSync({ cwd: root }),
]) {
  mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
  writeFileSync(path.join(out, file), readFileSync(path.join(root, file)));
}

let sourceRevision: string | undefined;
if (app === "radio") {
  const revision =
    process.env.SOURCE_REVISION ??
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error("SOURCE_REVISION must be a full git commit hash");
  }
  // Archives contain tracked source only, never local credentials or dependencies.
  // An extracted source archive can be rebuilt without a Git checkout.
  const files = process.env.SOURCE_REVISION
    ? readFileSync(path.join(root, "SOURCE_FILES.txt"), "utf8")
    : execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  const staging = mkdtempSync(path.join(tmpdir(), "avoid-source-"));
  try {
    for (const file of files.trim().split("\n")) {
      const target = path.join(staging, file);
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(root, file), target);
    }
    writeFileSync(path.join(staging, "SOURCE_FILES.txt"), files);
    execFileSync("tar", [
      "-czf",
      path.join(out, "source.tar.gz"),
      "-C",
      staging,
      ".",
    ]);
  } finally {
    rmSync(staging, { force: true, recursive: true });
  }
  sourceRevision = revision;
}
writeFileSync(path.join(out, "build.json"), JSON.stringify({ sourceRevision }));

console.log(`Prepared ${app} licenses for ${visited.size} packages`);
