# Identity server benchmark

Host: 16 vCPU (AMD EPYC), 31.4 GiB RAM. Server pinned to CPUs 0-3 with a 2g memory limit, PostgreSQL 16 on 4-5, k6 on 6-15. One stack at a time.
Load: 32 VUs, 3 × 60s per scenario after a 20s warm-up; each figure is the median of the runs.

## Footprint

|  | Image | Image size | First boot | Restart | Idle RAM | Password hash as stored |
| --- | --- | --- | --- | --- | --- | --- |
| **idenplane** | `idenplane:final` | 751 MiB | 4.9 s | 3.4 s | 194 MiB | `argon2id m=65536,p=4,t=3` |
| **authentik** | `ghcr.io/goauthentik/server:2026.8.5` | 1,848 MiB | 83.8 s | 8.2 s | 652 MiB | `pbkdf2_sha256 iterations=1000000` |
| **idenplane-4-workers** | `idenplane:final` | 751 MiB | 5.5 s | 4.2 s | 762 MiB | `argon2id m=65536,p=4,t=3` |
| **keycloak** | `quay.io/keycloak/keycloak:26.8.2` | 715 MiB | 24.1 s | 6.4 s | 464 MiB | `{"hashIterations":5,"algorithm":"argon2","additionalParameters":{"hashLength":["32"],"memory":["7168"],"type":["id"],"version":["1.3"],"parallelism":["1"]}}` |
| **keycloak-argon2-parity** | `quay.io/keycloak/keycloak:26.8.2` | 715 MiB | 24.9 s | 6.4 s | 465 MiB | `{"hashIterations":3,"algorithm":"argon2","additionalParameters":{"hashLength":["32"],"memory":["65536"],"type":["id"],"version":["1.3"],"parallelism":["4"]}}` |
| **zitadel** | `ghcr.io/zitadel/zitadel:v4.20.1` | 226 MiB | 3.6 s | 1.2 s | 71 MiB | `bcrypt cost 14 ($2a$14$...) in eventstore.events2` |

First boot is container start to ready on an empty database (schema creation included); restart is the same on an existing one.

## Throughput and latency

| Scenario | idenplane req/s | authentik req/s | idenplane-4-workers req/s | keycloak req/s | keycloak-argon2-parity req/s | zitadel req/s | idenplane p95 ms | authentik p95 ms | idenplane-4-workers p95 ms | keycloak p95 ms | keycloak-argon2-parity p95 ms | zitadel p95 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| discovery | 4,476 | 42 | 17,901 | 14,914 | 15,093 | 4,756 | 8.0 | 1,129.5 | 3.4 | 3.6 | 3.4 | 9.0 |
| jwks | 4,818 | 46 | 19,107 | 14,561 | 14,954 | 4,218 | 7.4 | 985.2 | 2.9 | 3.8 | 3.7 | 9.4 |
| client_credentials | 2,536 | 7 | 3,924 | 2,240 | 2,254 | 485 | 18.6 | 8,331.3 | 15.9 | 22.7 | 23.0 | 76.6 |
| introspect | 2,870 | 41 | 9,225 | 8,803 | 8,744 | 1,370 | 13.7 | 1,076.4 | 4.9 | 5.9 | 6.0 | 27.9 |
| password | 23 | not supported | 24 | 115 | 19 | not supported | 1,497.3 | not supported | 2,143.3 | 323.6 | 1,854.5 | not supported |

## Under load

| Scenario | idenplane peak RAM | authentik peak RAM | idenplane-4-workers peak RAM | keycloak peak RAM | keycloak-argon2-parity peak RAM | zitadel peak RAM | idenplane CPU | authentik CPU | idenplane-4-workers CPU | keycloak CPU | keycloak-argon2-parity CPU | zitadel CPU | lowest success |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| discovery | 237 MiB | 851 MiB | 809 MiB | 701 MiB | 882 MiB | 120 MiB | 100% | 136% | 395% | 385% | 384% | 168% | 99.48% |
| jwks | 236 MiB | 849 MiB | 791 MiB | 727 MiB | 901 MiB | 121 MiB | 102% | 128% | 394% | 386% | 390% | 190% | 99.81% |
| client_credentials | 233 MiB | 952 MiB | 799 MiB | 734 MiB | 937 MiB | 121 MiB | 241% | 198% | 395% | 392% | 393% | 279% | 99.72% |
| introspect | 234 MiB | 845 MiB | 779 MiB | 765 MiB | 960 MiB | 123 MiB | 113% | 143% | 398% | 389% | 387% | 264% | 99.48% |
| password | 510 MiB | not supported | 1,066 MiB | 787 MiB | 1,124 MiB | not supported | 356% | not supported | 381% | 331% | 372% | not supported | 100.00% |

CPU is docker-stats percent of one core, averaged over the run, summed over every container of the server (Authentik runs two). Images are referenced by digest in summary.json.

## Notes

- **authentik**: introspect checks a machine (client_credentials) token, not a user's.
- **authentik**: The Authentik password grant is an alias of client_credentials that checks an app-password token instead of the stored user password hash, so the password scenario is skipped; introspection checks a client_credentials token. Every client_credentials request also upserts the service-account user of the client, stores the access token and writes a login Event row that the worker then processes, so the worker on the same CPUs does work under that load; introspection is a db lookup of the stored token. Server and worker share TARGET_CPUS and each has its own TARGET_MEM cap, so the stack may use up to 2x TARGET_MEM. The web server runs at its defaults (web.workers=2, web.threads=4: two Python processes, so at most about two cores of request handling).
- **zitadel**: introspect checks a machine (client_credentials) token, not a user's.
- **zitadel**: introspection checks a machine-user (client_credentials) token, not a user token; access tokens are JWT; client secrets (machine user and API app) are bcrypt cost 4 and verified on every token and introspection request; token endpoint also accepts CLIENT_AUTH=basic: yes
