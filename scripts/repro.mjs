// Starts the local Convex backend, enqueues two jobs on a maxParallelism: 1
// pool, loses the first job's `complete`, and watches past the 5-minute
// recovery threshold. Exits 1 if the bug reproduces, 0 if the pool recovers.
import { execFileSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { anyApi as api } from "convex/server";

const WATCH_MS = Number(process.env.WATCH_MS ?? 8 * 60_000);
const POLL_MS = 30_000;

// Earlier runs leave their stuck job in the pool, so start from an empty database.
for (const path of ["convex_local_backend.sqlite3", "convex_local_storage"]) {
  rmSync(new URL(`../.convex/local/default/${path}`, import.meta.url), { recursive: true, force: true });
}

const dev = spawn("npx", ["convex", "dev", "--typecheck", "disable"], {
  env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
const stopDev = () => {
  try { process.kill(-dev.pid, "SIGTERM"); } catch {}
};
process.on("exit", stopDev);
process.on("SIGINT", () => process.exit(130));

await new Promise((resolve, reject) => {
  const onData = (chunk) => {
    if (String(chunk).includes("Convex functions ready")) resolve();
  };
  dev.stdout.on("data", onData);
  dev.stderr.on("data", onData);
  dev.on("exit", (code) => reject(new Error(`convex dev exited (${code})`)));
});

const client = new ConvexHttpClient("http://127.0.0.1:3210");
const ids = await client.mutation(api.repro.start, {});
const startedAt = Date.now();
console.log("enqueued", ids);

let state;
while (Date.now() - startedAt < WATCH_MS) {
  await new Promise((r) => setTimeout(r, POLL_MS));
  state = await client.query(api.repro.inspect, ids);
  const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
  console.log(`t+${minutes}min`, JSON.stringify(state));
  if (state.completions.some((c) => c.name === "lost")) break;
}

console.log("\nworkpool component's scheduled functions:");
console.log(
  execFileSync("npx", ["convex", "data", "--component", "workpool", "_scheduled_functions", "--format", "jsonLines"], {
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((f) => /worker|complete|recover/.test(f.name))
    .map((f) => `  ${new Date(f.scheduledTime).toISOString()} ${f.name} ${f.state.kind}${f.state.error ? `: ${f.state.error}` : ""} ${f.name.includes("recover") ? JSON.stringify(f.args) : ""}`)
    .join("\n"),
);

const lostFreed = state.completions.some((c) => c.name === "lost");
const ranLost = state.jobRuns.includes("lost");
if (ranLost && !lostFreed && state.status.lost.state === "running") {
  console.log(
    "\nREPRODUCED: job 'lost' ran successfully, its complete failed, and after " +
      `${WATCH_MS / 60_000} min it still holds the only slot: onComplete never ran, ` +
      "status stays 'running', and job 'waiting' never started.",
  );
  process.exit(1);
}
console.log("\nNOT REPRODUCED: the pool freed the job.");
process.exit(0);
