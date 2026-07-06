# Contributing to the BugBoard JavaScript SDK

Thanks for helping improve the SDK! This guide covers everything you need to get a change from
idea to merged pull request.

## Before you start

- **Bugs & features** — open an [issue](https://github.com/bug-board/bugboard-js/issues) first
  so we can discuss the approach before you invest time in code.
- **Wire-contract changes** — the request format, auth schemes, retry policy, and the
  16-method reporting surface are defined by the BugBoard SDK specification (the
  [API reference](https://bugboard.dev/docs/api-reference)) and implemented identically by every
  official SDK. Changes to that contract must be discussed in an issue first; SDK repos don't
  diverge from the spec on their own.
- **Security issues** — never open a public issue; see [SECURITY.md](SECURITY.md).

## Development setup

You need Node 18+ (Node 22 recommended) and npm.

```bash
git clone https://github.com/bug-board/bugboard-js.git
cd bugboard-js
npm install
```

Day-to-day commands:

```bash
npm test              # run the test suite once
npm run test:watch    # run tests in watch mode
npm run typecheck     # TypeScript, no emit
npm run lint          # ESLint
npm run lint:fix      # ESLint with autofix
npm run format        # Prettier, write
npm run format:check  # Prettier, check only
npm run build         # build dist/ with tsup (ESM + CJS + types)
```

Please make sure `npm run lint`, `npm run typecheck`, `npm test`, and `npm run format:check`
all pass before opening a pull request — CI runs exactly these.

## Project principles

Keep these invariants in mind; they are what make the SDK safe to embed in other people's apps:

1. **Never throw into the host app.** Every public method is fire-and-forget; failures go to
   the debug logger.
2. **No dependencies on the default path.** Only platform APIs (`fetch`, WebCrypto). The
   sealed-box binding (`tweetnacl-sealedbox-js`) is a bundled dependency, lazy-loaded only when
   payload encryption is enabled — apps that never encrypt load nothing extra.
3. **Never log key material.** The logger redacts secrets; keep it that way.
4. **The 16 reporting methods are generated**, not hand-written — extend the severity/priority
   tables in `src/types.ts` rather than adding one-off methods.
5. **Clamp before sending.** Title ≤ 255 chars, tags ≤ 50 chars, description well under the
   64 KB server cap.

## Making changes

1. Fork the repo and create a branch from `main`:
   `git checkout -b fix/queue-overflow-count`.
2. Make your change, **with tests**. Every behavior fix or feature needs coverage in `test/`.
3. Update `README.md` if you changed anything user-facing, and add an entry under
   `## [Unreleased]` in `CHANGELOG.md`.
4. Run the checks listed above.
5. Open a pull request against `main` and fill in the template.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/) **without scopes**:

```text
feat: add flushSync fallback for Safari pagehide
fix: honor Retry-After on 429 responses
docs: clarify sampling guidance
test: cover queue overflow accounting
chore: bump dev dependencies
ci: run tests on Node 24
```

- Subject in the imperative mood, lower-case, no trailing period.
- No scopes (`feat:` — never `feat(queue):`), no emoji.
- Keep each commit to one logical change; we prefer a clean history over squash-everything.

## Pull request expectations

- CI must be green (lint, typecheck, tests on Node 18/20/22, build).
- New behavior is documented and tested.
- Breaking changes are called out explicitly in the PR description.
- One approving review is required before merge.

## Releases

Maintainers cut releases. Versioning follows [SemVer](https://semver.org/); the changelog
follows [Keep a Changelog](https://keepachangelog.com/).

## Code of conduct

Participation in this project is governed by our
[Code of Conduct](CODE_OF_CONDUCT.md). Be kind.
