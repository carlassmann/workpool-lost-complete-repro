import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  jobRuns: defineTable({ name: v.string() }),
  completions: defineTable({ name: v.string(), result: v.any() }),
});
