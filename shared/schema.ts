import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { z } from "zod";

// ============================================================================
// Step 常量
// ============================================================================
export const STEP_IDS = [
  "discovery",
  "definition",
  "solution",
  "mvp",
  "build",
  "ship",
] as const;
export type StepId = (typeof STEP_IDS)[number];

export const STEP_META: Record<
  StepId,
  { name: string; subtitle: string; description: string }
> = {
  discovery: {
    name: "需求发现",
    subtitle: "Problem Discovery",
    description: "帮助用户发现真实问题，验证 AI 是否真的有价值。",
  },
  definition: {
    name: "问题定义",
    subtitle: "Problem Definition",
    description: "把模糊想法变成具体问题，明确输入输出和最短路径。",
  },
  solution: {
    name: "方案设计",
    subtitle: "Solution Design",
    description: "设计 AI 解决方案，拆解 AI 与非 AI 的边界。",
  },
  mvp: {
    name: "最小 Demo",
    subtitle: "MVP Design",
    description: "只保留最小可运行版本，明确第一版闭环。",
  },
  build: {
    name: "实现路径",
    subtitle: "Build Plan",
    description: "为小白生成可执行的开发方案与技术栈。",
  },
  ship: {
    name: "展示迭代",
    subtitle: "Ship & Iterate",
    description: "把 Demo 变成可展示项目，并规划后续迭代。",
  },
};

export const STEP_MIN_QUESTIONS = 2;
export const STEP_MAX_QUESTIONS = 5;

// ============================================================================
// Generated Content
// ============================================================================
export const generatedContentSchema = z.object({
  summary: z.string(),
  keyQuestions: z.array(z.string()),
  analysis: z.string(),
  suggestedOutput: z.record(z.any()),
  risks: z.array(z.string()),
  decisions: z.array(z.string()),
  extensionSpace: z.array(z.string()),
  nextStepHint: z.string(),
  userEdited: z.record(z.boolean()).default({}),
  touchedFields: z.array(z.string()).default([]),
});
export type GeneratedContent = z.infer<typeof generatedContentSchema>;

// ============================================================================
// QA
// ============================================================================
export const stepQAItemSchema = z.object({
  questionId: z.string(),
  question: z.string(),
  targetField: z.enum([
    "userInput",
    "constraints",
    "extensionSpace",
    "memory",
  ]),
  options: z.array(z.string()),
  selectedOptions: z.array(z.string()),
  freeText: z.string().default(""),
  supersededBy: z.string().optional(),
  supersedes: z.string().optional(),
  createdAt: z.number(),
});
export type StepQAItem = z.infer<typeof stepQAItemSchema>;

// ============================================================================
// Step
// ============================================================================
export const stepStateSchema = z.object({
  id: z.enum(STEP_IDS),
  name: z.string(),
  status: z.enum(["pending", "generated", "saved", "locked"]),
  locked: z.boolean(),
  userInput: z.string().default(""),
  constraints: z.string().default(""),
  extensionSpace: z.string().default(""),
  memory: z.string().default(""),
  qa: z.array(stepQAItemSchema).default([]),
  qaComplete: z.boolean().default(false),
  generatedContent: generatedContentSchema.nullable(),
  updatedAt: z.number(),
});
export type StepState = z.infer<typeof stepStateSchema>;

// ============================================================================
// Boundary
// ============================================================================
export const productBoundarySchema = z.object({
  targetUser: z.string().default(""),
  ioShape: z.string().default(""),
  notDoing: z.string().default(""),
  notes: z.string().default(""),
  confirmedAt: z.number().default(0),
});
export type ProductBoundary = z.infer<typeof productBoundarySchema>;

export const emptyProductBoundary: ProductBoundary = {
  targetUser: "",
  ioShape: "",
  notDoing: "",
  notes: "",
  confirmedAt: 0,
};

// ============================================================================
// Global Memory
// ============================================================================
export const globalMemorySchema = z.object({
  longTermGoal: z.string().default(""),
  userPreference: z.string().default(""),
  technicalConstraints: z.string().default(""),
  confirmedDecisions: z.string().default(""),
  excludedScope: z.string().default(""),
  futureIdeas: z.string().default(""),
  risks: z.string().default(""),
  ideaSummary: z.string().default(""),
  ideaTags: z.string().default(""),
  productBoundary: productBoundarySchema.default(emptyProductBoundary),
  builderTestContext: z
    .string()
    .default("Red Finance Builder Test / 48 小时 Demo"),
});
export type GlobalMemory = z.infer<typeof globalMemorySchema>;

export const emptyGlobalMemory: GlobalMemory = {
  longTermGoal: "",
  userPreference: "",
  technicalConstraints: "",
  confirmedDecisions: "",
  excludedScope: "",
  futureIdeas: "",
  risks: "",
  ideaSummary: "",
  ideaTags: "",
  productBoundary: emptyProductBoundary,
  builderTestContext: "Red Finance Builder Test / 48 小时 Demo",
};

// ============================================================================
// Hydrated project (used in API responses)
// ============================================================================
export const hydratedProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  initialIdea: z.string(),
  globalMemory: globalMemorySchema,
  steps: z.record(stepStateSchema),
  finalPRD: z.string().default(""),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type HydratedProject = z.infer<typeof hydratedProjectSchema>;

// ============================================================================
// Snapshot
// ============================================================================
export const projectSnapshotSchema = z.object({
  snapshotVersion: z.literal("2.0"),
  exportedAt: z.number(),
  project: hydratedProjectSchema,
});
export type ProjectSnapshot = z.infer<typeof projectSnapshotSchema>;

// ============================================================================
// SQLite table
// ============================================================================
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  initialIdea: text("initial_idea").notNull(),
  globalMemory: text("global_memory").notNull(),
  steps: text("steps").notNull(),
  finalPRD: text("final_prd").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type ProjectRow = typeof projects.$inferSelect;

export const insertProjectInputSchema = z.object({
  name: z.string().min(1),
  initialIdea: z.string().min(1),
});
export type InsertProjectInput = z.infer<typeof insertProjectInputSchema>;
