// Fault injection: makes the workpool's scheduled `complete` mutation throw for
// jobs whose function returned LOSE_COMPLETE, standing in for a platform error
// (e.g. "Your request timed out performing too many system operations").
// Only the scheduled entry point is wrapped; recovery's direct completeHandler
// call is untouched.
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL(
  "../node_modules/@convex-dev/workpool/dist/component/complete.js",
  import.meta.url,
);
const marker = "/* injected-lost-complete */";
const original = "export const complete = internalMutation({\n    args: completeArgs,\n    handler: completeHandler,\n});";
const injected = `export const complete = internalMutation({
    args: completeArgs,
    handler: async (ctx, args) => { ${marker}
        if (args.jobs.some((job) => job.runResult.kind === "success" && job.runResult.returnValue === "LOSE_COMPLETE")) {
            throw new Error("injected: simulated platform error in complete");
        }
        return completeHandler(ctx, args);
    },
});`;

const source = readFileSync(file, "utf8");
if (source.includes(marker)) {
  console.log("fault already injected");
} else if (!source.includes(original)) {
  throw new Error("complete.js has an unexpected shape; update inject-fault.mjs");
} else {
  writeFileSync(file, source.replace(original, injected));
  console.log("fault injected into", file.pathname);
}
