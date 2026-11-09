---
id: benchmarks
title: Benchmarks
description: Idenplane measured against Keycloak, Zitadel and Authentik on the same machine, with the method and raw results.
---

# Benchmarks

Idenplane, Keycloak, Zitadel and Authentik were measured on the same machine, under the same limits, with the same load. The harness is in [`benchmarks/compare`](https://github.com/idenplane/idenplane/tree/dev/benchmarks/compare), and the raw results of the run below are in [`benchmarks/published/2026-11-09`](https://github.com/idenplane/idenplane/tree/dev/benchmarks/published/2026-11-09).

Run on 2026-11-09. Idenplane was built from commit `9ed358a`.

## Setup

- **Host:** one cloud machine with 16 vCPU (AMD EPYC) and 31.4 GiB RAM. Only one server stack was up at a time.
- **CPU and memory:** the server was pinned to 4 CPUs (0–3) with a 2 GiB memory limit. PostgreSQL 16 had CPUs 4–5, and the load generator ([k6](https://grafana.com/docs/k6/latest/)) had CPUs 6–15.
- **Load:** 32 virtual users. Each scenario ran 3 × 60 s after a 20 s warm-up, and each figure is the median of the three runs.

The servers and their settings:

| Name                        | Server             | Settings                                                                     |
| --------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| **Idenplane**               | Idenplane          | Default settings: one process (`WEB_CONCURRENCY=1`).                         |
| **Idenplane, 4 workers**    | Idenplane          | `WEB_CONCURRENCY=auto`, one worker per CPU it may use.                       |
| **Keycloak**                | Keycloak 26.8.2    | Its defaults.                                                                |
| **Keycloak, Argon2 parity** | Keycloak 26.8.2    | Hashes passwords with the same Argon2id cost as Idenplane: 64 MiB, t=3, p=4. |
| **Zitadel**                 | Zitadel v4.20.1    |                                                                              |
| **Authentik**               | Authentik 2026.8.5 | Its default web server.                                                      |

Every image except the locally built Idenplane one is pinned by digest in the raw results.

The scenarios:

| Scenario             | Request                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `discovery`          | `GET /.well-known/openid-configuration`                                       |
| `jwks`               | the realm's public signing keys                                               |
| `client_credentials` | a token for a confidential client                                             |
| `introspect`         | `POST` introspection of a valid access token                                  |
| `password`           | the resource-owner password grant, which hashes the password on every request |

## Throughput

Requests per second; higher is better. These are medians of three runs.

| Scenario           | Idenplane | Idenplane, 4 workers | Keycloak | Keycloak, Argon2 parity | Zitadel | Authentik |
| ------------------ | --------: | -------------------: | -------: | ----------------------: | ------: | --------: |
| discovery          |     4,476 |           **17,901** |   14,914 |                  15,093 |   4,756 |        42 |
| jwks               |     4,818 |           **19,107** |   14,561 |                  14,954 |   4,218 |        46 |
| client_credentials |     2,536 |            **3,924** |    2,240 |                   2,254 |     485 |         7 |
| introspect         |     2,870 |            **9,225** |    8,803 |                   8,744 |   1,370 |        41 |
| password           |        23 |                   24 |      115 |                      19 |     n/a |       n/a |

## Latency

p95 latency in milliseconds; lower is better.

| Scenario           | Idenplane | Idenplane, 4 workers | Keycloak | Keycloak, Argon2 parity | Zitadel | Authentik |
| ------------------ | --------: | -------------------: | -------: | ----------------------: | ------: | --------: |
| discovery          |       8.0 |                  3.4 |      3.6 |                     3.4 |     9.0 |   1,129.5 |
| jwks               |       7.4 |                  2.9 |      3.8 |                     3.7 |     9.4 |     985.2 |
| client_credentials |      18.6 |                 15.9 |     22.7 |                    23.0 |    76.6 |   8,331.3 |
| introspect         |      13.7 |                  4.9 |      5.9 |                     6.0 |    27.9 |   1,076.4 |
| password           |   1,497.3 |              2,143.3 |    323.6 |                 1,854.5 |     n/a |       n/a |

All Idenplane, Keycloak and Zitadel requests succeeded. Authentik failed up to 0.5% of the requests in some runs.

## Footprint

|                         | Image size | First boot | Restart | Idle RAM |               Peak RAM under load |
| ----------------------- | ---------: | ---------: | ------: | -------: | --------------------------------: |
| Idenplane               |    751 MiB |      4.9 s |   3.4 s |  194 MiB |   237 MiB (510 MiB on `password`) |
| Idenplane, 4 workers    |    751 MiB |      5.5 s |   4.2 s |  762 MiB | 809 MiB (1,066 MiB on `password`) |
| Keycloak                |    715 MiB |     24.1 s |   6.4 s |  464 MiB |                           787 MiB |
| Keycloak, Argon2 parity |    715 MiB |     24.9 s |   6.4 s |  465 MiB |                         1,124 MiB |
| Zitadel                 |    226 MiB |      3.6 s |   1.2 s |   71 MiB |                           123 MiB |
| Authentik               |  1,848 MiB |     83.8 s |   8.2 s |  652 MiB |                           952 MiB |

How these were measured:

- **Image size:** uncompressed.
- **First boot:** from container start to ready, on an empty database, including schema creation.
- **Restart:** the same, on an existing database.
- **RAM:** from `docker stats`, summed over every container of the server. Authentik runs two: server and worker.

## Reading the results

- **Default vs. 4 workers.** By default Idenplane runs one process, which uses one CPU. `WEB_CONCURRENCY=auto` runs one worker per CPU. That is what lets it use all four CPUs here, and it costs about 190 MiB of RAM per worker. See [Environment Variables](./configuration/environment-variables.md).
- **Password hashing.** The `password` figures mostly measure the hash cost.
  - Keycloak's default is Argon2id at 7 MiB, t=5, p=1, which is much cheaper than Idenplane's 64 MiB, t=3, p=4.
  - That is why stock Keycloak does 115 sign-ins per second.
  - The _Keycloak, Argon2 parity_ column uses the same hash cost as Idenplane and is the fair comparison.
- **Zitadel and Authentik.** Neither verifies a user password through the password grant, so `password` does not apply to them. Their `introspect` checks a machine (client_credentials) token rather than a user token.
  - On every token and introspection request, Zitadel verifies a bcrypt-hashed client secret.
  - On every token request, Authentik writes the service-account user, the token and an event row. Its default web server handles requests in two Python processes.
- **Where Idenplane is not ahead.**
  - Zitadel has a much smaller image and uses much less memory.
  - Keycloak's image is slightly smaller.
  - With 4 workers, Idenplane uses more memory than Keycloak at idle.

## Reproducing

You need Docker with Compose, `curl`, `openssl`, and a machine with at least 8 CPUs.

```bash
# One target at a time; results go to benchmarks/results/compare/<target>/.
bash benchmarks/compare/compare.sh idenplane
WEB_CONCURRENCY=auto RESULTS_DIR=$PWD/benchmarks/results/workers \
  bash benchmarks/compare/compare.sh idenplane
bash benchmarks/compare/compare.sh keycloak
bash benchmarks/compare/compare.sh keycloak-argon2-parity
bash benchmarks/compare/compare.sh zitadel
bash benchmarks/compare/compare.sh authentik

node benchmarks/compare/report.mjs benchmarks/results/compare
```

To measure your own build, set `IDENPLANE_IMAGE`. The other settings are listed at the top of `compare.sh`. Absolute numbers depend on the machine, so compare servers only within one run on one host.
