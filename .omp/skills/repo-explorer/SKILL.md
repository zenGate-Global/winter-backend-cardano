---
name: repo-explorer
description: Explore, inspect, compare, or answer questions about external repositories using a reusable local cache at ~/.explore/repos. Use when the user names a GitHub/GitLab/Bitbucket URL, owner/repo shorthand, package name, or another repository that is not already in the current workspace.
allowed-tools: Read Grep Glob Bash(mkdir -p ~/.explore/repos*) Bash(ls -la ~/.explore/repos*) Bash(git clone *) Bash(git -C ~/.explore/repos/* status *) Bash(git -C ~/.explore/repos/* rev-parse *) Bash(git -C ~/.explore/repos/* log *) Bash(git -C ~/.explore/repos/* branch *) Bash(find ~/.explore/repos/* -maxdepth *) Bash(rg *) Bash(npm view *) Bash(npm pack *) Bash(pnpm view *) Bash(pnpm pack *) Bash(python -m pip download *) Bash(pip download *) Bash(cargo info *) Bash(cargo search *) Bash(go env *) Bash(go list *) Bash(mvn dependency:get *) Bash(mvn dependency:copy *) Bash(gradle dependencyInsight *) Bash(curl *) Bash(tar *) Bash(unzip *)
---

# Repo Explorer

Use this skill to inspect external repositories without cluttering the active workspace.

## Cache

Use `~/.explore/repos` as the local repository cache.

Start every repo-exploration task by listing the cache:

```bash
mkdir -p ~/.explore/repos
ls -la ~/.explore/repos
```

## Flow

1. Identify the target repository and the user's question.
   - URL: `https://github.com/owner/repo`, `git@github.com:owner/repo.git`, GitLab, or Bitbucket.
   - Shorthand: treat `owner/repo` as `https://github.com/owner/repo`.
   - Package name: first try to find the upstream source repository from the package metadata.
   - Local path: use it directly; do not copy it into the cache.
2. Prefer upstream source from GitHub/GitLab/Bitbucket.
   - If package metadata includes a repository URL, clone that repository.
   - Use the packaged artifact only when no source repository is available, the repo is inaccessible, or the user specifically asks about published package contents.
3. Choose a stable cache directory name:
   - Prefer `<owner>_<repo>`.
   - For package artifacts, prefer `<ecosystem>_<package>` or `<ecosystem>_<package>_<version>`.
   - Strip `.git`.
   - Replace `/`, `@`, and other unsafe path characters with `_`.
   - Keep names lowercase when possible.
4. If the repository or extracted package already exists in `~/.explore/repos`, inspect that checkout.
   - Do not refresh or mutate it unless the user asks for latest/current state.
   - If freshness matters, report the current commit and ask or refresh according to the user's request.
5. If it is not cached and a repo URL is available, clone it into the chosen directory:

```bash
mkdir -p ~/.explore/repos
git clone <repo-url> ~/.explore/repos/<owner>_<repo>
```

6. If no repo URL is available, pull source from the package manager into the cache.
7. Explore from the cached checkout or extracted package.
   - Start with top-level files, package manifests, docs, and config.
   - Use targeted search after the first structure pass.
   - Read source files before answering implementation questions.
   - Prefer facts with file paths and line numbers.

## Package Fallback Examples

Use package-manager artifacts only after checking for an upstream repository first.

JavaScript / TypeScript:

```bash
npm view <package> repository.url
mkdir -p ~/.explore/repos/npm_<package>
npm pack <package>@<version-or-latest> --pack-destination ~/.explore/repos/npm_<package>
tar -xzf ~/.explore/repos/npm_<package>/*.tgz -C ~/.explore/repos/npm_<package> --strip-components=1
```

Python:

```bash
mkdir -p ~/.explore/repos/pypi_<package>
python -m pip download --no-deps --no-binary=:all: <package> -d ~/.explore/repos/pypi_<package>
tar -xf ~/.explore/repos/pypi_<package>/*.tar.gz -C ~/.explore/repos/pypi_<package> --strip-components=1
```

If no source distribution exists, retry without `--no-binary=:all:` and unzip the wheel, then say the artifact is packaged Python byte/source distribution rather than an upstream repository.

Rust:

```bash
cargo info <crate>
mkdir -p ~/.explore/repos/crate_<crate>
curl -L https://crates.io/api/v1/crates/<crate>/<version>/download -o ~/.explore/repos/crate_<crate>/crate.tar.gz
tar -xzf ~/.explore/repos/crate_<crate>/crate.tar.gz -C ~/.explore/repos/crate_<crate> --strip-components=1
```

Go:

```bash
go list -m -json <module>
mkdir -p ~/.explore/repos/go_<module-name>
git clone <repository-from-module-metadata> ~/.explore/repos/go_<module-name>
```

JVM:

```bash
mkdir -p ~/.explore/repos/maven_<group>_<artifact>
mvn dependency:copy -Dartifact=<group>:<artifact>:<version>:jar:sources -DoutputDirectory=~/.explore/repos/maven_<group>_<artifact>
unzip -q ~/.explore/repos/maven_<group>_<artifact>/*-sources.jar -d ~/.explore/repos/maven_<group>_<artifact>
```

If only a binary package is available, say that source was not available from the registry and limit conclusions accordingly.

## Output

Answer from the repository evidence, not from the README alone. Include:

- Cache path used.
- Commit or branch inspected when relevant.
- Whether the source came from an upstream repo or a package artifact.
- Key files inspected.
- Concrete answer with file references.
- Gaps or uncertainty if the requested behavior is not visible in the repo.

Do not leave cloned repositories in the active workspace. Keep reusable external checkouts under `~/.explore/repos`.
