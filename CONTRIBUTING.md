# Contributing to Idenplane

Thank you for your interest in contributing to Idenplane!

## Getting Started

### Development Setup

1. **Clone the repository**
```bash
git clone https://github.com/idenplane/idenplane.git
cd Idenplane
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment**
```bash
cp .env.example .env
# Edit .env with your database credentials
```

4. **Start development database**
```bash
docker compose up -d
```

5. **Run database migrations**
```bash
npm run db:migrate
```

6. **Seed development data**
```bash
npm run db:seed
```

7. **Start development server**
```bash
npm run start:dev
```

### Required Tools

- Node.js 20+
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

When submitting a PR:

1. **Fill out the PR template** with:
   - Clear description of changes
   - Link to related issue(s)
   - Testing evidence
   - Screenshots (for UI changes)

2. **Ensure all checks pass**
   - Build succeeds
   - All tests pass
   - No linting errors

3. **Keep PRs focused**
   - One feature or fix per PR
   - Smaller PRs are reviewed faster

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

```
src/
├── auth/           # Authentication logic
├── admin-auth/     # Admin authentication
├── clients/         # Client management
├── groups/          # Group management
├── roles/          # Role-based access control
├── users/           # User management
├── tokens/          # Token issuance & validation
├── login/           # Login flows
├── mfa/             # Multi-factor authentication
├── oauth/           # OAuth 2.0 implementation
├── saml/            # SAML 2.0 implementation
├── webauthn/        # WebAuthn/FIDO2
├── realms/          # Realm management
├── common/          # Shared utilities
├── crypto/          # Cryptographic operations
├── prisma/          # Database service
├── rate-limit/      # Rate limiting
└── ...
```

## Database Guidelines

### Prisma Usage

- Always use Prisma Client for database operations
- Use `select` to limit returned fields
- Use `include` for related records when needed
- Avoid raw SQL queries unless necessary

### Migrations

```bash
# Create a new migration
npm run db:migrate:create -- --name add_new_table

# Apply migrations
npm run db:migrate

# Reset database (development only)
npm run db:reset
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

**DO NOT** report security vulnerabilities via GitHub Issues.

Email: security@idenplane.com (or follow your organization's responsible disclosure policy)

## Questions?

- GitHub Discussions: https://github.com/idenplane/idenplane/discussions
- Discord: https://discord.gg/idenplane
- Documentation: https://idenplane.com/docs

## License

By contributing, you agree that your contributions will be licensed under the project's AGPL-3.0 license. See the [LICENSE](LICENSE) file for the full text.
