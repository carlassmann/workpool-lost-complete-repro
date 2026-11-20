# workpool: lost `complete` keeps a mutation job running forever

```sh
npm install     # postinstall: scripts/inject-fault.mjs makes the scheduled `complete` throw for one job
npm run repro   # local backend, ~9 min, exits 1 when reproduced
```

Run logs are in `logs/` (0.4.14, 0.4.16, 0.5.0). The repro uses a local backend instead of convex-test because recovery depends on real scheduler state and timing.

Issue: https://github.com/convex/workpool/issues/276
