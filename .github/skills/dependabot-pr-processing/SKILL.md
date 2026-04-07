---
applyTo: '**'
---

# Dependabot PR Processing Skill

Process dependabot pull requests efficiently by classifying them as safe (auto-merge after compile test) or manual (requires runtime/audio testing).

## Classification Rules

### Safe to auto-merge (compile-only verification)
These packages do NOT touch audio/voice event handling or runtime behavior:

- **devDependencies** (never shipped): `eslint`, `eslint-config-*`, `@types/*`, `typescript`, `prettier`, lint plugins
- **Auth-only SDKs**: `Azure.Identity` (C#), `azure-identity` (Java), `@azure/identity` (JS) — HTTP/auth layer only
- **Project management SDKs**: `Azure.AI.Projects` — control-plane only
- **Environment loading**: `dotenv` — startup config only

### Requires manual voice/event testing
These packages participate in the audio/voice event pipeline:

- **Voice SDKs**: `azure-ai-voicelive` (any language), `@azure/ai-voicelive`
- **Core event libraries**: `azure-core` (Java) — provides `BinaryData`, reactive streams, WebSocket framing used by voice SDK
- **Runtime frameworks**: `next`, `express`, `spring-boot-starter-parent` — SSR/WebSocket/server behavior changes
- **UI component libraries with runtime impact**: `lucide-react`, `@fluentui/react-components`, `react`, `react-dom`

### Close without merge (do manually as coordinated upgrade)
Major version bumps that likely have breaking changes:

- Any **major version** bump (e.g., vite 5→8, TypeScript 5→6, ESLint 9→10, Tailwind 3→4, Spring Boot 3→4)
- Check the migration guide first — if mechanical, can be batched

## Processing Workflow

### Step 1: Classify
For each open dependabot PR, determine:
1. Is it a devDependency or runtime dependency?
2. Does it touch the voice/event pipeline? (Check imports in source files for `azure-core`, `BinaryData`, `VoiceLiveAsyncClient`, etc.)
3. Is it a major version bump?

### Step 2: Handle safe PRs
1. Create a branch from main: `chore/dependabot-safe-updates`
2. For each safe PR, merge its branch into the working branch
3. Run the build tests: `./tests/build-all.ps1`
4. If builds pass, push and create a single PR
5. After merge, the individual dependabot PRs auto-close (or close manually)

### Step 3: Consolidate manual-test PRs
1. Group related manual-test PRs by project/ecosystem
2. Create a single branch: `chore/dependabot-manual-review`
3. Apply all changes
4. Create a PR with a checklist of what needs manual voice/audio testing
5. Close individual dependabot PRs with comment: "Consolidated into PR #N"

### Step 4: Close major-bump PRs
Close with comment explaining the major version needs a coordinated manual upgrade.

## Build Test Commands

Run from repo root:

```powershell
# Test everything
./tests/build-all.ps1

# Test specific language
./tests/build-all.ps1 -Language javascript
./tests/build-all.ps1 -Language java
./tests/build-all.ps1 -Language csharp

# Test specific projects
./tests/build-all.ps1 -Projects @("javascript/voice-live-avatar")
```

## Build Quirks
- JS quickstarts have no build scripts — use `npm ci && node --check <file>.js`
- Java AgentsNewQuickstart uses non-standard `pom-agent.xml`
- Java ModelQuickstart has `<sourceDirectory>.</sourceDirectory>` (sources in root)
- C# projects target mixed frameworks: `net8.0` and `net9.0`
- `voice-live-universal-assistant/javascript` is runtime-only (Express), no build step — `npm ci` is sufficient
