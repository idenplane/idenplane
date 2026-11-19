# Contributing to Idenplane

Thank you for your interest in contributing to Idenplane!

## Getting Started

### Fork and clone

1. **Fork the repository** on GitHub (the "Fork" button at the top of [idenplane/idenplane](https://github.com/idenplane/idenplane)).

2. **Clone your fork** and add the upstream repo as a remote:
```bash
git clone https://github.com/<your-username>/idenplane.git
cd idenplane
git remote add upstream https://github.com/idenplane/idenplane.git
```

3. **Keep your fork in sync** before starting new work:
```bash
git fetch upstream
git checkout dev
git merge upstream/dev
```

### Development Setup

1. **Install dependencies**
```bash
npm ci
```

2. **Set up environment**
```bash
node scripts/setup-env.cjs
# Writes .env with unique local secrets and a DATABASE_URL that matches
# the compose database. It refuses to overwrite an existing .env.
```

3. **Start the development database**
```bash
docker compose up -d db
```
Only `db`: a bare `docker compose up -d` also starts the published `app` image on port 3000, which then blocks `npm run start:dev`.

4. **Run migrations and seed development data**
```bash
npm run db:setup
```

Or separately, if you only want one of them:

```bash
npm run prisma:migrate   # apply migrations
npm run prisma:seed      # seed development data
```

5. **Start development server**
```bash
npm run start:dev
```

The [development setup guide](https://idenplane.com/contributing/development-setup) covers the admin console, the docs site, using your own Postgres and the common failures. Its steps are run in CI on Linux, macOS and WSL.

### Required Tools

- Node.js 24 (the version CI and the Docker image use; 22 is not tested)
- npm 10+
- Docker & Docker Compose
- Git

## Development Workflow

### 1. Branch Naming

Create branches with descriptive names:

```
fix/<issue-number>-<short-description>
feat/<feature-name>
chore/<maintenance-task>
docs/<documentation-task>
```

Examples:
- `fix/580-idor-token-introspection`
- `feat/add-saml-support`
- `chore/update-dependencies`

### 2. Making Changes

1. **Create a new branch**
```bash
git checkout -b fix/your-issue-description
```

2. **Make your changes**
- Follow the existing code style
- Write tests for new functionality
- Update documentation as needed

3. **Run tests**
```bash
npm test
```

4. **Run linting**
```bash
npm run lint
```

5. **Build the project**
```bash
npm run build
```

### 3. Commit Messages

Use clear, descriptive commit messages:

```
type(scope): short description

- Detailed description (if needed)
- Bullet points for multiple changes
```

Types: `fix`, `feat`, `chore`, `docs`, `test`, `refactor`, `perf`, `security`

Examples:
```
fix(tokens): prevent user enumeration in introspection

feat(mfa): add TOTP verification step-up flow

docs(api): update authentication endpoints documentation
```

### 4. Pull Requests

Your first pull request that changes the server needs a signed [Contributor License Agreement](#contributor-license-agreement); a bot comment on the pull request tells you how.

When submitting a PR:

1. **Fill out the PR template** with:
   - Clear description of changes
   - Link to related issue(s)
   - Testing evidence
   - Screenshots (for UI changes)

2. **Ensure all checks pass**
   - `license/cla` (the CLA is signed, where needed)
   - Build succeeds
   - All tests pass
   - No linting errors

3. **Keep PRs focused**
   - One feature or fix per PR
   - Smaller PRs are reviewed faster

### 5. Review Process

Idenplane currently has a single maintainer, so review turnaround depends on their availability rather than a formal rotation — there's no assigned-reviewer system or required approval count beyond that.

- All required CI checks (build, lint, tests) must be green before a PR is merged; a red check is treated as "not ready," not "waiting for an override."
- The maintainer may ask for changes directly on the PR — respond with new commits rather than force-pushing over review comments, so the diff stays reviewable.
- Approved PRs are merged into `dev` with a merge commit, so the PR's commits stay in history. Keep them readable, and follow the commit message format above.
- The full review, merge and release rules are in [GOVERNANCE.md](GOVERNANCE.md).
- There's no fixed SLA on review time. For anything time-sensitive (a security fix, a broken build), say so explicitly in the PR description.

## Code Standards

### TypeScript

- Use explicit types (no `any`)
- Prefer `interface` over `type` for object shapes
- Use proper null handling with strict null checks

### Error Handling

- Always handle errors with proper try/catch blocks
- Use specific error types (`BadRequestException`, `NotFoundException`, etc.)
- Log errors with appropriate context

### Security

- Never expose secrets in logs or responses
- Use parameterized queries (Prisma handles this)
- Validate all input with class-validator DTOs
- Follow OWASP security guidelines

### Testing

- Write tests for new functionality
- Maintain or improve coverage
- Unit tests for services
- E2E tests for critical flows

## Project Structure

The backend has about 70 NestJS modules under `src/`, each self-contained (its own controllers/services/DTOs) — too many to keep an accurate list here without it going stale. A representative sample:

```
src/
├── auth/              # Authentication logic
├── admin-auth/        # Admin authentication
├── oauth/             # OAuth 2.0 implementation
├── saml/              # SAML 2.0 implementation
├── webauthn/          # WebAuthn/FIDO2
├── realms/            # Realm management
├── users/, groups/, roles/, clients/  # Core identity model
├── plugins/           # Plugin loading & integrity verification
├── prisma/            # Database service
├── common/            # Shared utilities
└── ...
```

For the full module map, grouped by concern, with a system diagram, see the [Architecture Overview](/contributing/architecture) on the docs site.

## Database Guidelines

### Prisma Usage

- Always use Prisma Client for database operations
- Use `select` to limit returned fields
- Use `include` for related records when needed
- Avoid raw SQL queries unless necessary

### Migrations

```bash
# Create a new migration
npm run prisma:migrate -- --name add_new_table

# Apply migrations
npm run prisma:migrate

# Reset database (development only) — drops, re-migrates and re-seeds
npx prisma migrate reset
```

## Reporting Issues

### Bug Reports

Include:
- Clear description of the bug
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Node version, OS, etc.)
- Relevant logs or error messages

### Feature Requests

Include:
- Clear description of the feature
- Use case / motivation
- Potential alternatives considered

### Security Vulnerabilities

**DO NOT** report security vulnerabilities via GitHub Issues, Discussions or pull requests.

Report them privately through [GitHub private vulnerability reporting](https://github.com/idenplane/idenplane/security/advisories/new), or by email to security@idenplane.com. See [SECURITY.md](SECURITY.md).

## Questions?

- GitHub Discussions, Q&A: https://github.com/idenplane/idenplane/discussions/new?category=q-a
- Where to go for what, and what to expect: [SUPPORT.md](SUPPORT.md)

## Contributor License Agreement

Before your first pull request that changes the server can be merged, you sign the [Idenplane Contributor License Agreement](CLA.md) (CLA). You sign once, on GitHub, and it covers all your contributions.

### Why there is one

The Idenplane server is licensed under the AGPL-3.0. The maintainer also licenses it commercially, to organizations that cannot comply with the AGPL, and runs it as a hosted service; that income pays for the project. A contribution received only under the AGPL could not be included in either. The CLA gives the maintainer that right, so he can accept your contribution without keeping two versions of the code apart.

What it does and does not do:

- **You keep the copyright** in your contribution. The CLA is a license, not a transfer: you give the maintainer a broad, permanent license to use, change and relicense it, including commercially, and a patent license for it.
- **Your contribution stays open source.** Whenever the maintainer distributes your contribution as part of Idenplane, it is also available under the open-source license of the part you changed (section 4 of the CLA). The commercial license is an additional option, not a replacement.
- The license goes to the maintainer as named in the CLA, and to anyone who takes over the project from him under the same commitment (section 9).
- It is based on the Apache Software Foundation's contributor agreements, which many projects use.

### When you need it

| Your pull request changes | CLA needed? |
| --- | --- |
| anything outside the two directories below: the server, admin console, docs, examples, themes, Helm chart, ... | Yes |
| only `packages/` (the SDKs and client packages) or `terraform-provider-idenplane/`, which are MIT-licensed | No: the MIT License already allows every use |

### What happens on your first pull request

1. A check named **`license/cla`** runs on every pull request. If you, or another author of its commits, have not signed yet, it fails and a bot comment explains how to sign.
2. Read [CLA.md](CLA.md). To sign it, post a comment on the pull request that consists of exactly this sentence:

   ```
   I have read the Idenplane CLA (version 1.0) and I agree to its terms.
   ```
3. The check records your signature and turns green. If it does not update, comment `/cla recheck`.

Your signature is recorded publicly in the [`cla-signatures`](https://github.com/idenplane/idenplane/tree/cla-signatures) branch of this repository: your GitHub user name and account id, the time, the pull request and comment, and the CLA version and its checksum. You do not sign again for later pull requests.

Every commit must be authored with an email address that is linked to your GitHub account, so that it can be matched to your signature. A commit whose email is not linked fails the check until you add the email to your account (GitHub **Settings → Emails**) or rewrite the commit.

### If your employer owns your work

Many employment contracts give the employer the rights to code you write, sometimes even in your own time. If yours does, either:

- get your employer's permission to contribute under the CLA, and then sign it yourself (section 5 of the CLA says you have that permission); or
- have your employer sign the corporate CLA (Part 2 of [CLA.md](CLA.md)) by emailing licensing@idenplane.com, with the GitHub accounts of the employees it covers. The maintainer records those accounts as signed.

## License

Your contributions are licensed under the license of the part you change: AGPL-3.0 for the server (see [LICENSE](LICENSE)), and MIT for the SDKs and client packages under `packages/` and for `terraform-provider-idenplane/`, as their own LICENSE files say. If you signed the [CLA](CLA.md), you have also granted the maintainer the license it describes.
