# Benchmark run of 2026-11-09

Raw results behind [the benchmarks page](../../../docs/docs/benchmarks.md). `REPORT.md` and `summary.json` were generated from them with:

```bash
node benchmarks/compare/report.mjs benchmarks/published/2026-11-09
```

- **Idenplane:** built with the repository `Dockerfile` from commit `9ed358a` on `dev`, tagged `idenplane:final` on the benchmark host. `idenplane` ran with the default `WEB_CONCURRENCY=1`, and `idenplane-4-workers` ran with `WEB_CONCURRENCY=auto` (one worker per CPU it may use, here 4).
- **Other images:** each one is pinned by digest in its `meta.json`.
- **Host:** a single 16 vCPU AMD EPYC cloud machine with 31.4 GiB RAM. Every target ran on it, one after another.
- **Directories:** each one holds a k6 summary (`<scenario>-<run>.json`) and a `docker stats` sample file (`<scenario>-<run>.stats`) for every run, plus `idle.stats` and `meta.json`.
- **Removed data:** k6's `setup_data` was taken out of the summaries. It held the access tokens the load used, which came from the throwaway benchmark realms.
