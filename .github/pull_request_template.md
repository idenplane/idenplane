<!--
  Thanks for contributing to Idenplane! Please fill out the sections below so reviewers
  can understand the change and verify it.

  Pull requests target `dev`. For security fixes, report privately first
  (https://github.com/idenplane/idenplane/security/advisories/new, see SECURITY.md)
  and coordinate before opening a public PR.
-->

## Summary

<!-- One paragraph: what changed and why. -->

## Linked issues

<!-- e.g. Closes #123, Refs #456 -->

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to break)
- [ ] Documentation update
- [ ] Internal refactor / chore (no user-facing change)

## How was this tested?

<!--
  Describe how you verified the change works. For backend changes: unit tests, e2e tests,
  manual API calls. For admin-ui changes: screenshots or recordings, browser tested.
-->

- [ ] Unit tests added / updated
- [ ] E2E tests added / updated (where applicable)
- [ ] Manually tested

## Security impact

<!--
  Does this change touch authentication, authorization, sessions, tokens, cryptography,
  secrets, input validation, tenant/realm isolation, or what an unauthenticated caller can reach?
  If yes, say what changes and why it is safe. If no, write "None".
  Do not describe an unfixed vulnerability here: report it privately instead.
-->

## Screenshots / recordings

<!-- For UI changes, before/after screenshots or a short recording. -->

## Checklist

- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] `npm run build:all` succeeds
- [ ] Tests cover the change (new behaviour, and the bug for a fix)
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]` (if user-facing), with a **Before you upgrade** note if operators must act
- [ ] Security impact is described above
- [ ] If schema changed: a Prisma migration is included
- [ ] If user-facing: README / docs updated
- [ ] If breaking: documented in the description and in `DECISIONS.md`
