import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import { storage } from "./storage";
import {
  STEP_IDS,
  STEP_META,
  insertProjectInputSchema,
  productBoundarySchema,
  projectSnapshotSchema,
  type StepId,
  type StepQAItem,
  type HydratedProject,
} from "@shared/schema";
import {
  buildBoundaryOptions,
  detectConflict,
  generateStepContent,
  generateSuggestions,
  getLLMHealth,
  getProvider,
  nextQuestionFor,
  projectAnswersToFields,
  realCapable,
  shouldBeComplete,
  summarizeIdea,
} from "./agent";
import { buildExports } from "./exports";
import { runOrchestrator } from "./orchestrator";

function newId(): string {
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
  );
}

async function loadProject(req: Request, res: Response): Promise<HydratedProject | undefined> {
  const id = String(req.params.id);
  const project = await storage.getProject(id);
  if (!project) {
    res.status(404).json({ error: "PROJECT_NOT_FOUND" });
    return undefined;
  }
  return project;
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // -------------------------------------------------------------------------
  // Meta
  // -------------------------------------------------------------------------
  app.get("/api/meta/steps", (_req, res) => {
    res.json({ stepIds: STEP_IDS, meta: STEP_META });
  });

  app.get("/api/meta/agent-mode", (_req, res) => {
    const p = getProvider();
    const capable = realCapable();
    const health = getLLMHealth();
    // "real" only when we are real-capable AND the most recent call actually
    // succeeded. If real-capable but never called yet, surface as "real-pending"
    // so the banner can still say "Real configured—awaiting first call".
    const mode: "mock" | "real" | "real-pending" = !capable
      ? "mock"
      : health.lastSucceeded
        ? "real"
        : health.lastCallAt
          ? "mock" // real-capable, but last call failed
          : "real-pending";
    res.json({
      mode,
      auxMode: mode,
      provider: p.provider,
      model: p.model,
      baseUrl: p.baseUrl,
      consumesApi: capable,
      reproducible: !capable,
      temperature: process.env.LLM_TEMPERATURE ? Number(process.env.LLM_TEMPERATURE) : null,
      seed: process.env.LLM_SEED ? Number(process.env.LLM_SEED) : null,
      realCapable: capable,
      lastStepCallSucceeded: health.lastSucceeded,
      lastCallAt: health.lastCallAt,
      lastError: health.lastError,
    });
  });

  // -------------------------------------------------------------------------
  // Projects CRUD
  // -------------------------------------------------------------------------
  app.get("/api/projects", async (_req, res) => {
    const list = await storage.listProjects();
    res.json(
      list.map((p) => ({
        id: p.id,
        name: p.name,
        initialIdea: p.initialIdea,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        ideaSummary: p.globalMemory.ideaSummary,
        boundaryConfirmed: !!p.globalMemory.productBoundary.confirmedAt,
      })),
    );
  });

  app.get("/api/projects/:id", async (req, res) => {
    const project = await loadProject(req, res);
    if (!project) return;
    res.json(project);
  });

  app.post("/api/projects", async (req, res) => {
    const parsed = insertProjectInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "INVALID_INPUT", message: parsed.error.message });
    }
    const project = await storage.createProject({
      id: newId(),
      name: parsed.data.name,
      initialIdea: parsed.data.initialIdea,
    });
    const { summary, tags } = await summarizeIdea(parsed.data.initialIdea, parsed.data.name);
    project.globalMemory.ideaSummary = summary;
    project.globalMemory.ideaTags = tags.join(",");
    await storage.saveProject(project);
    res.status(201).json(project);
  });

  app.patch("/api/projects/:id", async (req, res) => {
    const project = await loadProject(req, res);
    if (!project) return;
    const { name, initialIdea, globalMemory } = req.body || {};
    if (typeof name === "string" && name.trim()) project.name = name.trim();
    if (typeof initialIdea === "string" && initialIdea.trim()) {
      project.initialIdea = initialIdea.trim();
      const { summary, tags } = await summarizeIdea(project.initialIdea, project.name);
      project.globalMemory.ideaSummary = summary;
      project.globalMemory.ideaTags = tags.join(",");
    }
    if (globalMemory && typeof globalMemory === "object") {
      project.globalMemory = { ...project.globalMemory, ...globalMemory };
    }
    const saved = await storage.saveProject(project);
    res.json(saved);
  });

  app.delete("/api/projects/:id", async (req, res) => {
    await storage.deleteProject(req.params.id);
    res.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Boundary (Step 0)
  // -------------------------------------------------------------------------
  app.get("/api/projects/:id/boundary/options", async (req, res) => {
    const project = await loadProject(req, res);
    if (!project) return;
    res.json(buildBoundaryOptions(project));
  });

  app.post("/api/projects/:id/boundary/draft", async (req, res) => {
    const project = await loadProject(req, res);
    if (!project) return;
    const parsed = productBoundarySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "INVALID_BOUNDARY" });
    }
    project.globalMemory.productBoundary = {
      ...project.globalMemory.productBoundary,
      ...parsed.data,
    };
    const saved = await storage.saveProject(project);
    res.json(saved);
  });

  app.post("/api/projects/:id/boundary/confirm", async (req, res) => {
    const project = await loadProject(req, res);
    if (!project) return;
    const parsed = productBoundarySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "INVALID_BOUNDARY" });
    }
    project.globalMemory.productBoundary = {
      ...project.globalMemory.productBoundary,
      ...parsed.data,
      confirmedAt: Date.now(),
    };
    const saved = await storage.saveProject(project);
    res.json(saved);
  });

  // -------------------------------------------------------------------------
  // QA per step
  // -------------------------------------------------------------------------
  app.get("/api/projects/:id/qa/:stepId/next", async (req, res) => {
    const project = await loadProject(req, res);
    if (!project) return;
    const stepId = req.params.stepId as StepId;
    if (!STEP_IDS.includes(stepId)) return res.status(400).json({ error: "BAD_STEP" });
    const step = project.steps[stepId];
    const next = await nextQuestionFor(project, stepId, step.qa);
    if (!next) {
      return res.json({ done: true });
    }
    res.json({ done: false, question: next });
  });

  app.post("/api/projects/:id/qa/:stepId/answer", async (req, res) => {
    const project = await loadProject(req, res);
    if (!project) return;
    const stepId = req.params.stepId as StepId;
    if (!STEP_IDS.includes(stepId)) return res.status(400).json({ error: "BAD_STEP" });
    const step = project.steps[stepId];
    if (step.locked) return res.status(409).json({ error: "STEP_LOCKED" });

    const {
      questionId,
      question,
      targetField,
      options,
      selectedOptions,
      freeText,
    } = req.body || {};
    if (!questionId || !question || !targetField) {
      return res.status(400).json({ error: "MISSING_FIELDS" });
    }
    const newAnswer = [...(selectedOptions || []), freeText || ""].join(" ");
    const conflict = await detectConflict(step.qa, newAnswer, targetField);
    if (conflict) {
      return res.json({
        conflict,
        candidate: {
          questionId,
          question,
          targetField,
          options: options || [],
          selectedOptions: selectedOptions || [],
          freeText: freeText || "",
          createdAt: Date.now(),
        },
      });
    }
    const item: StepQAItem = {
      questionId,
      question,
      targetField,
      options: options || [],
      selectedOptions: selectedOptions || [],
      freeText: freeText || "",
      createdAt: Date.now(),
    };
    step.qa.push(item);
    const fields = projectAnswersToFields(step.qa);
    step.userInput = fields.userInput;
    step.constraints = fields.constraints;
    step.extensionSpace = fields.extensionSpace;
    step.memory = fields.memory;
    step.qaComplete = shouldBeComplete(step.qa);
    step.updatedAt = Date.now();
    const saved = await storage.saveProject(project);
    res.json({ ok: true, project: saved });
  });

  app.post("/api/projects/:id/qa/:stepId/resolve-conflict", async (req, res) => {
    const project = await loadProject(req, res);
    if (!project) return;
    const stepId = req.params.stepId as StepId;
    if (!STEP_IDS.includes(stepId)) return res.status(400).json({ error: "BAD_STEP" });
    const step = project.steps[stepId];
    if (step.locked) return res.status(409).json({ error: "STEP_LOCKED" });
    const { keep, priorQuestionId, candidate } = req.body || {};
    if (!candidate) return res.status(400).json({ error: "MISSING_CANDIDATE" });
    if (keep === "prior") {
      // Drop the candidate, keep prior. Mark prior as superseded by candidate's question id (no-op).
    } else if (keep === "new") {
      // Mark the prior superseded
      const prior = step.qa.find((q) => q.questionId === priorQuestionId);
      if (prior) prior.supersededBy = candidate.questionId;
      step.qa.push({ ...candidate, supersedes: priorQuestionId });
    } else {
      return res.status(400).json({ error: "INVALID_KEEP" });
    }
    const fields = projectAnswersToFields(step.qa);
    step.userInput = fields.userInput;
    step.constraints = fields.constraints;
    step.extensionSpace = fields.extensionSpace;
    step.memory = fields.memory;
    step.qaComplete = shouldBeComplete(step.qa);
    step.updatedAt = Date.now();
    const saved = await storage.saveProject(project);
    res.json({ ok: true, project: saved });
  });

  app.post("/api/projects/:id/qa/:stepId/reset", async (req, res) => {
    const project = await loadProject(req, res);
    if (!project) return;
    const stepId = req.params.stepId as StepId;
    if (!STEP_IDS.includes(stepId)) return res.status(400).json({ error: "BAD_STEP" });
    const step = project.steps[stepId];
    if (step.locked) return res.status(409).json({ error: "STEP_LOCKED" });
    step.qa = [];
    step.qaComplete = false;
    step.userInput = "";
    step.constraints = "";
    step.extensionSpace = "";
    step.memory = "";
    step.updatedAt = Date.now();
    const saved = await storage.saveProject(project);
    res.json({ ok: true, project: saved });
  });

  app.get("/api/projects/:id/suggestions/:stepId", async (req, res) => {
    const project = await loadProject(req, res);
    if (!project) return;
    const stepId = req.params.stepId as StepId;
    if (!STEP_IDS.includes(stepId)) return res.status(400).json({ error: "BAD_STEP" });
    res.json(generateSuggestions(project, stepId));
  });

  // -------------------------------------------------------------------------
  // Step field edit (touched-set)
  // -------------------------------------------------------------------------
  app.patch("/api/projects/:id/step/:stepId", async (req, res) => {
    const project = await loadProject(req, res);
    if (!project) return;
    const stepId = req.params.stepId as StepId;
    if (!STEP_IDS.includes(stepId)) return res.status(400).json({ error: "BAD_STEP" });
    const step = project.steps[stepId];
    if (step.locked) return res.status(409).json({ error: "STEP_LOCKED" });
    const allowed = ["userInput", "constraints", "extensionSpace", "memory"] as const;
    const touched = new Set(
      step.generatedContent?.touchedFields || [],
    );
    for (const k of allowed) {
      if (typeof req.body?.[k] === "string") {
        (step as any)[k] = req.body[k];
        touched.add(k);
      }
    }
    if (step.generatedContent) {
      step.generatedContent.touchedFields = Array.from(touched);
      const ue = { ...(step.generatedContent.userEdited || {}) };
      for (const k of allowed) if (typeof req.body?.[k] === "string") ue[k] = true;
      step.generatedContent.userEdited = ue;
    }
    step.updatedAt = Date.now();
    const saved = await storage.saveProject(project);
    res.json(saved);
  });

  app.post("/api/projects/:id/step/:stepId/lock", async (req, res) => {
    const project = await loadProject(req, res);
    if (!project) return;
    const stepId = req.params.stepId as StepId;
    if (!STEP_IDS.includes(stepId)) return res.status(400).json({ error: "BAD_STEP" });
    const step = project.steps[stepId];
    const lock = req.body?.locked !== false;
    step.locked = lock;
    step.status = lock ? "locked" : (step.generatedContent ? "generated" : "pending");
    step.updatedAt = Date.now();
    const saved = await storage.saveProject(project);
    res.json(saved);
  });

  // -------------------------------------------------------------------------
  // Generate
  // -------------------------------------------------------------------------
  app.post("/api/generate", async (req, res) => {
    const { projectId, stepId } = req.body || {};
    if (!projectId || !stepId || !STEP_IDS.includes(stepId)) {
      return res.status(400).json({ error: "INVALID_INPUT" });
    }
    const project = await storage.getProject(projectId);
    if (!project) return res.status(404).json({ error: "PROJECT_NOT_FOUND" });
    const step = project.steps[stepId as StepId];
    if (step.locked) return res.status(409).json({ error: "STEP_LOCKED" });

    const { content: generated, mode } = await generateStepContent(project, stepId as StepId);
    // preserve user-touched flags
    if (step.generatedContent) {
      generated.userEdited = step.generatedContent.userEdited;
      generated.touchedFields = step.generatedContent.touchedFields;
      // do not overwrite touched fields on the step itself
      // (their values stay; only generatedContent updates the structured output)
    }
    step.generatedContent = generated;
    step.status = "generated";
    step.updatedAt = Date.now();
    const saved = await storage.saveProject(project);
    res.json({ ok: true, mode, project: saved });
  });

  // -------------------------------------------------------------------------
  // PRD aggregation
  // -------------------------------------------------------------------------
  app.post("/api/projects/:id/prd", async (req, res) => {
    const project = await loadProject(req, res);
    if (!project) return;
    const { generatePRD } = await import("./exports");
    const result = generatePRD(project);
    project.finalPRD = result.markdown;
    await storage.saveProject(project);
    res.json({
      markdown: result.markdown,
      prdMode: result.mode,
      missingSteps: result.missingSteps,
      readySteps: result.readySteps,
    });
  });

  // -------------------------------------------------------------------------
  // Exports & Submission
  // -------------------------------------------------------------------------
  app.get("/api/projects/:id/exports", async (req, res) => {
    const project = await loadProject(req, res);
    if (!project) return;
    const publicLink = (req.query.publicLink as string) || "";
    const out = buildExports(project, publicLink);
    res.json(out);
  });

  app.get("/api/projects/:id/submission", async (req, res) => {
    const project = await loadProject(req, res);
    if (!project) return;
    const publicLink = (req.query.publicLink as string) || "";
    const out = buildExports(project, publicLink);
    res.json({
      markdown: out.submissionBrief.markdown,
      missing: out.submissionBrief.missing,
      xhsFields: out.submissionBrief.xhsFields,
      demoLinkOk: out.demoLinkOk,
      readiness: out.readiness.submissionBrief,
    });
  });

  // -------------------------------------------------------------------------
  // Multi-Agent Orchestrator report
  // -------------------------------------------------------------------------
  app.get("/api/projects/:id/orchestrator", async (req, res) => {
    const project = await loadProject(req, res);
    if (!project) return;
    const publicLink = (req.query.publicLink as string) || "";
    const exp = buildExports(project, publicLink);
    const reports = runOrchestrator(project, exp.readiness, exp.demoLinkOk);
    res.json({ reports, readiness: exp.readiness, demoLinkOk: exp.demoLinkOk });
  });

  // -------------------------------------------------------------------------
  // Snapshot import / export
  // -------------------------------------------------------------------------
  app.get("/api/projects/:id/snapshot", async (req, res) => {
    const project = await loadProject(req, res);
    if (!project) return;
    res.json({
      snapshotVersion: "2.0",
      exportedAt: Date.now(),
      project,
    });
  });

  app.post("/api/projects/import", async (req, res) => {
    const parsed = projectSnapshotSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "INVALID_SNAPSHOT", message: parsed.error.message });
    const incoming = parsed.data.project;
    const existing = await storage.getProject(incoming.id);
    let id = incoming.id;
    if (existing) {
      // create copy with new id to avoid overwriting
      id = newId();
    }
    const project = await storage.createProject({
      id,
      name: incoming.name + (existing ? " (导入副本)" : ""),
      initialIdea: incoming.initialIdea,
    });
    project.globalMemory = incoming.globalMemory;
    project.steps = incoming.steps;
    project.finalPRD = incoming.finalPRD;
    const saved = await storage.saveProject(project);
    res.json(saved);
  });

  return httpServer;
}
