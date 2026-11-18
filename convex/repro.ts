import { Workpool, vOnCompleteArgs, vWorkId, type WorkId } from "@convex-dev/workpool";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";

const pool = new Workpool(components.workpool, { maxParallelism: 1 });

export const job = internalMutation({
  args: { name: v.string(), loseComplete: v.boolean() },
  handler: async (ctx, { name, loseComplete }) => {
    await ctx.db.insert("jobRuns", { name });
    // The injected fault makes `complete` throw for this return value.
    return loseComplete ? "LOSE_COMPLETE" : "ok";
  },
});

export const onComplete = internalMutation({
  args: vOnCompleteArgs(v.string()),
  handler: async (ctx, { context, result }) => {
    await ctx.db.insert("completions", { name: context, result });
  },
});

export const start = mutation({
  args: {},
  handler: async (ctx) => {
    const enqueue = (name: string, loseComplete: boolean) =>
      pool.enqueueMutation(ctx, internal.repro.job, { name, loseComplete }, {
        onComplete: internal.repro.onComplete,
        context: name,
      });
    return {
      lost: await enqueue("lost", true),
      waiting: await enqueue("waiting", false),
    };
  },
});

export const inspect = query({
  args: { lost: vWorkId, waiting: vWorkId },
  handler: async (ctx, ids) => ({
    status: {
      lost: await pool.status(ctx, ids.lost as WorkId),
      waiting: await pool.status(ctx, ids.waiting as WorkId),
    },
    jobRuns: (await ctx.db.query("jobRuns").collect()).map((r) => r.name),
    completions: (await ctx.db.query("completions").collect()).map((c) => ({
      name: c.name,
      result: c.result,
    })),
  }),
});
