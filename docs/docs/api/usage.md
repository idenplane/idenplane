---
id: usage
title: Instance Usage API
description: Monthly active users, users and realms for a whole Idenplane instance
---

# Instance Usage API

One call reports how much an Idenplane instance is used: its monthly active users (MAU), user accounts and realms, in total and per realm. It is meant for billing and capacity planning, for example by a control panel that runs one instance per customer and bills on monthly active users, but any self-hoster can use it.

```
GET /admin/system/usage
```

## Authentication

Server-wide: the admin API key, or the access token of a `super-admin`. A `realm-admin` or `view-only` admin gets `403`.

```bash
curl "http://localhost:3000/admin/system/usage" \
  -H "x-admin-api-key: $ADMIN_API_KEY"
```

## Query parameters

| Parameter | Description |
|---|---|
| `month` | The calendar month to report, `YYYY-MM`, in UTC. Optional; the current month by default. A month in the future, or any other format, is refused with `400`. |

To bill a month, call it once the month is over (`period.closed` is `true`), for example on the 1st of the next month:

```bash
curl "http://localhost:3000/admin/system/usage?month=2026-10" \
  -H "x-admin-api-key: $ADMIN_API_KEY"
```

## Response

```json
{
  "version": "0.14.2",
  "generatedAt": "2026-11-01T06:00:00.000Z",
  "period": {
    "month": "2026-10",
    "start": "2026-10-01T00:00:00.000Z",
    "end": "2026-11-01T00:00:00.000Z",
    "closed": true,
    "complete": true,
    "pruned": false
  },
  "tracking": {
    "since": "2026-09-14T08:12:44.120Z"
  },
  "retention": {
    "months": 13,
    "oldestMonth": "2025-10"
  },
  "totals": {
    "realms": 2,
    "users": 1342,
    "monthlyActiveUsers": 418
  },
  "realms": [
    {
      "id": "3c0f1d0e-4a57-4c8e-9a4e-5b2f1a7d9c11",
      "name": "acme",
      "deleted": false,
      "users": 1340,
      "monthlyActiveUsers": 409
    },
    {
      "id": "7d9e2b4a-1f3c-4e6a-8b5d-0c2a9f8e7b65",
      "name": "master",
      "deleted": false,
      "users": 2,
      "monthlyActiveUsers": 1
    },
    {
      "id": "a1b2c3d4-0000-4000-8000-000000000001",
      "name": null,
      "deleted": true,
      "users": 0,
      "monthlyActiveUsers": 8
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `version` | The server version. |
| `generatedAt` | When the report was computed. |
| `period.start`, `period.end` | The month's boundaries in UTC: `start` included, `end` excluded. |
| `period.closed` | The month is over, so its count no longer changes. |
| `period.complete` | Activity was recorded for the whole month. See [Incomplete months](#incomplete-months). Always `false` for a pruned month. |
| `period.pruned` | The month is older than the retention and its activity has been deleted. Its counts are then `0` because they are gone, not because nobody was active. See [Retention](#retention-and-privacy). |
| `tracking.since` | When this instance started recording activity. |
| `retention.months` | `USAGE_ACTIVITY_RETENTION_MONTHS`: whole months kept before the current one, or `null` when pruning is off. |
| `retention.oldestMonth` | The oldest month still kept (`YYYY-MM`); every month before it is pruned. `null` when nothing has been or will be pruned. |
| `totals.realms` | Realms that exist now. |
| `totals.users` | User accounts now, in every realm, service accounts excluded. |
| `totals.monthlyActiveUsers` | Distinct users who were active in the month, in every realm. |
| `realms[]` | The same numbers per realm: existing realms by name, then deleted realms that had activity in the month (`deleted: true`, `name: null`). |

`users` is a snapshot at the time of the call, not the number at the end of the month. `monthlyActiveUsers` is fixed once the month is closed.

## What counts as active

A user is active in a month when, in that month (UTC), at least one of these happened to them:

- **An interactive sign-in** that ends in an SSO session: password, passkey, magic link, a custom auth flow, or a sign-in through an identity provider (OpenID Connect, SAML, social). This is the moment the session is created, after the second factor if there is one.
- **OAuth tokens issued for the user**: the authorization code, device code, password and `mfa_otp` grants, forward-auth, and **every token refresh**, offline tokens included. A user who stays signed in to an application through refresh tokens is active in every month the application refreshes.

  :::note Background refreshes count
  A refresh counts even when no person is looking at the screen. A mobile or desktop app that refreshes its tokens in the background (to sync, or to keep a session alive) makes its user active in every month it does so, even if the user never opens it. This is how hosted identity services commonly count monthly active users. If you bill on this number, refresh only when the app is actually used, or tell your customers that a signed-in, background-refreshing app counts.
  :::
- **A SAML assertion issued for the user** to a SAML service provider, also when it comes from an SSO session that started in an earlier month.
- **A request to a forward-auth protected application** with the user's proxy session, also when the session started in an earlier month.

Each user is counted once per month, however often they sign in, and in the realm they belong to.

Not counted:

- **Service accounts and machine identities.** `client_credentials` tokens have no user session, and service account users are left out of `users` too.
- **Impersonation.** An admin impersonating a user does not make the user active.
- **Admin console sign-ins.** The console has its own sign-in; it does not count, even for admins of the `master` realm. Users of the `master` realm who sign in to applications do count, under `master`.
- **Failed attempts**, sign-outs, registrations without a sign-in, password resets and an MFA challenge that was not completed.

This is not the same number as the realm dashboard's "active users", which counts password sign-in events over the last 30 days.

## How it is counted

Activity is recorded in its own table (`user_monthly_activity`): one row per user and month, written the first time the user is active in the month. Recording happens at the points listed above, whether or not the realm records login events. Each server process remembers which users it has already written this month, so a busy instance writes about one row per user per month, not one per request. A failure to write is logged and never fails the sign-in; the user's next sign-in or refresh writes it again.

The report reads the month's rows through the table's primary key and does not read login events, so it costs the same however many events the instance keeps.

**Not affected by event settings.** Login events are deleted after the realm's retention (30 days by default) and are not written at all in a realm with events turned off. Usage does not depend on them: a month can be billed long after it ended.

**Deleted users and realms.** The rows have no foreign keys. A user deleted after being active still counts for the months they were active, and so does a deleted realm, shown with `deleted: true`, until those months are pruned.

## Retention and privacy

**What is stored.** One row per active user and month: the month, the realm id, the user id and when the user was first seen in the month. No name, email, IP address or device.

**How long.** Months older than `USAGE_ACTIVITY_RETENTION_MONTHS` (default `13`) are deleted automatically. With `N`, the current month and the `N` whole months before it are kept. The default of 13 keeps the last closed month together with the same month a year earlier, and every closed month for over a year, which covers year-over-year comparisons and billing questions about the past year. Keep your own invoices or a copy of each month's report for longer-term records. `off` keeps every month. The minimum is `1`, so the current and the previous month are never deleted; any other value stops the server at startup. See the [environment variables](../configuration/environment-variables.md#instance-usage).

**After a user is deleted.** Their user id stays in the rows of the months they were active, so those months keep counting them, until the months are pruned. The id no longer leads to any personal data once the user is deleted. With pruning `off`, it is kept indefinitely.

**How pruning runs.** Every hour, on one instance only (the scheduled-job leader), in batches of 5000 rows, each its own short statement, so it never holds a long lock. Pruning first records the first month kept, so a pruned month is reported as `period.pruned: true` even half-way through, and still after the retention is raised or turned off: a deleted month cannot come back. Asking for a pruned month is not an error; the report says it is pruned.

## Incomplete months

`period.complete` is `false` for a month that started before the instance recorded activity (`tracking.since`):

- On an **upgrade**, recording starts when the migration that adds it runs. That migration also fills in earlier activity from the login events still kept: sign-ins, code and device-code exchanges, refreshes and `mfa_otp` grants. Events already deleted by the retention, and realms with events turned off, cannot be recovered, so the count of the upgrade month and of earlier months is a lower bound.
- On a **new install**, recording starts at the beginning of the month the database was created in, so every month is complete.

Every month from the first full month after the upgrade is complete.
