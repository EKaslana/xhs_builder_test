import {
  projects,
  STEP_IDS,
  STEP_META,
  globalMemorySchema,
  stepStateSchema,
  emptyGlobalMemory,
  type HydratedProject,
  type GlobalMemory,
  type StepState,
  type StepId,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs";

// Database file location.
//   - DATA_DIR (preferred): used by Render / Railway / Fly persistent disks.
//     The file lives at ${DATA_DIR}/data.db so the volume can be mounted
//     anywhere without code changes. We require that the directory either
//     already exists or can be created — if both fail (e.g. read-only FS,
//     no permission), we fall back to ./data.db so the app still boots.
//   - Otherwise uses ./data.db relative to the current working directory —
//     matches the original local-dev behaviour.
const dataDir = process.env.DATA_DIR?.trim();
let dbPath = "data.db";
if (dataDir) {
  let usable = false;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    // Probe writability — Render free tier has read-only paths that
    // mkdirSync can silently no-op on.
    fs.accessSync(dataDir, fs.constants.W_OK);
    usable = true;
  } catch (err) {
    console.warn(
      `[storage] DATA_DIR="${dataDir}" not usable (${(err as Error).message}); ` +
        `falling back to ./data.db (ephemeral, fine for demo).`,
    );
  }
  if (usable) dbPath = path.join(dataDir, "data.db");
}
console.log(`[storage] sqlite at ${path.resolve(dbPath)}`);

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

// Bootstrap schema (drizzle-kit not always available at runtime in cloud).
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    initial_idea TEXT NOT NULL,
    global_memory TEXT NOT NULL,
    steps TEXT NOT NULL,
    final_prd TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

export const db = drizzle(sqlite);

function emptyStep(id: StepId): StepState {
  return {
    id,
    name: STEP_META[id].name,
    status: "pending",
    locked: false,
    userInput: "",
    constraints: "",
    extensionSpace: "",
    memory: "",
    qa: [],
    qaComplete: false,
    generatedContent: null,
    updatedAt: Date.now(),
  };
}

export function emptySteps(): Record<StepId, StepState> {
  const result = {} as Record<StepId, StepState>;
  for (const id of STEP_IDS) {
    result[id] = emptyStep(id);
  }
  return result;
}

function hydrateGlobalMemory(raw: unknown): GlobalMemory {
  try {
    return globalMemorySchema.parse(raw ?? {});
  } catch {
    return { ...emptyGlobalMemory };
  }
}

function hydrateSteps(raw: unknown): Record<StepId, StepState> {
  const base = emptySteps();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  for (const id of STEP_IDS) {
    const candidate = obj[id];
    if (!candidate) continue;
    try {
      base[id] = stepStateSchema.parse({
        ...base[id],
        ...(candidate as object),
      });
    } catch {
      // keep empty
    }
  }
  return base;
}

function rowToProject(row: typeof projects.$inferSelect): HydratedProject {
  let memRaw: unknown = {};
  let stepsRaw: unknown = {};
  try {
    memRaw = JSON.parse(row.globalMemory);
  } catch {
    memRaw = {};
  }
  try {
    stepsRaw = JSON.parse(row.steps);
  } catch {
    stepsRaw = {};
  }
  return {
    id: row.id,
    name: row.name,
    initialIdea: row.initialIdea,
    globalMemory: hydrateGlobalMemory(memRaw),
    steps: hydrateSteps(stepsRaw),
    finalPRD: row.finalPRD ?? "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface IStorage {
  listProjects(): Promise<HydratedProject[]>;
  getProject(id: string): Promise<HydratedProject | undefined>;
  createProject(input: {
    id: string;
    name: string;
    initialIdea: string;
  }): Promise<HydratedProject>;
  saveProject(project: HydratedProject): Promise<HydratedProject>;
  deleteProject(id: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async listProjects(): Promise<HydratedProject[]> {
    const rows = db.select().from(projects).all();
    return rows.map(rowToProject);
  }
  async getProject(id: string): Promise<HydratedProject | undefined> {
    const row = db.select().from(projects).where(eq(projects.id, id)).get();
    return row ? rowToProject(row) : undefined;
  }
  async createProject(input: {
    id: string;
    name: string;
    initialIdea: string;
  }): Promise<HydratedProject> {
    const now = Date.now();
    const project: HydratedProject = {
      id: input.id,
      name: input.name,
      initialIdea: input.initialIdea,
      globalMemory: { ...emptyGlobalMemory },
      steps: emptySteps(),
      finalPRD: "",
      createdAt: now,
      updatedAt: now,
    };
    db.insert(projects)
      .values({
        id: project.id,
        name: project.name,
        initialIdea: project.initialIdea,
        globalMemory: JSON.stringify(project.globalMemory),
        steps: JSON.stringify(project.steps),
        finalPRD: "",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return project;
  }
  async saveProject(project: HydratedProject): Promise<HydratedProject> {
    const now = Date.now();
    const next: HydratedProject = { ...project, updatedAt: now };
    db.update(projects)
      .set({
        name: next.name,
        initialIdea: next.initialIdea,
        globalMemory: JSON.stringify(next.globalMemory),
        steps: JSON.stringify(next.steps),
        finalPRD: next.finalPRD,
        updatedAt: now,
      })
      .where(eq(projects.id, next.id))
      .run();
    return next;
  }
  async deleteProject(id: string): Promise<void> {
    db.delete(projects).where(eq(projects.id, id)).run();
  }
}

export const storage = new DatabaseStorage();
