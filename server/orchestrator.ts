/**
 * Multi-Agent Orchestrator (v1)
 * --------------------------------------------------------------------------
 * v1 不要求真实并发。Orchestrator 在后端统一调度 6 个 subagent，全部走 Mock
 * 路径（或单次 LLM 调用模拟）。每个 subagent 输出携带 provenance，可追溯回
 * 项目数据 / Step 0 边界 / 6 步内容。
 *
 * Subagent 角色：
 *  1. ProblemDiscoveryAgent  - 真实问题、目标用户、场景、需求真实性风险
 *  2. BoundaryCoachAgent     - Step 0 产品边界 3+1
 *  3. PRDAgent               - 把 6 步聚合成结构化 PRD
 *  4. BuildPlannerAgent      - README + 技术路径 + 任务拆解 + 48h 计划
 *  5. PitchAgent             - 小红书提交字段、Demo 说明、60 秒 Pitch
 *  6. ValidationAgent        - 缺失字段、Mock/Real provenance、Demo 链接、导出物 readiness
 */

import {
  STEP_IDS,
  STEP_META,
  type HydratedProject,
  type StepId,
} from "@shared/schema";
import { getLLMHealth, getProvider, realCapable } from "./agent";

export type SubagentRole =
  | "problem_discovery"
  | "boundary_coach"
  | "prd"
  | "build_planner"
  | "pitch"
  | "validation";

export type ProvenanceSource =
  | "project_data"
  | "step0_boundary"
  | `step:${StepId}`
  | "global_memory";

export type SubagentReport = {
  role: SubagentRole;
  title: string;
  responsibility: string;
  inputs: ProvenanceSource[];
  mode: "mock" | "real";
  provider: string;
  model: string;
  output: {
    headline: string;
    bullets: string[];
    markdown: string;
  };
  notes?: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isReady(s: any): boolean {
  return !!s?.generatedContent && ["generated", "saved", "locked"].includes(s.status);
}

function readyStepIds(project: HydratedProject): StepId[] {
  return STEP_IDS.filter((id) => isReady(project.steps[id]));
}

function modeAndProvider(): {
  mode: "mock" | "real";
  provider: string;
  model: string;
} {
  const p = getProvider();
  const health = getLLMHealth();
  // "real" if we are real-capable AND the most recent live call succeeded.
  // Otherwise honestly report "mock" — the orchestrator only summarizes
  // already-stored step content, so it inherits whichever mode produced it.
  const live = realCapable() && health.lastSucceeded;
  return {
    mode: live ? "real" : "mock",
    provider: live ? p.provider : realCapable() ? `${p.provider} (capable)` : "local",
    model: p.model,
  };
}

// ---------------------------------------------------------------------------
// 1. Problem Discovery Agent
// ---------------------------------------------------------------------------
function runProblemDiscovery(project: HydratedProject): SubagentReport {
  const { mode, provider, model } = modeAndProvider();
  const discovery = project.steps.discovery;
  const inputs: ProvenanceSource[] = ["project_data"];
  if (project.globalMemory.productBoundary.confirmedAt) inputs.push("step0_boundary");
  if (isReady(discovery)) inputs.push("step:discovery");

  const summary = isReady(discovery)
    ? discovery.generatedContent!.summary
    : `${project.name}：${project.initialIdea}`;
  const targetUser =
    project.globalMemory.productBoundary.targetUser || "单人浏览器场景的产品小白";

  const bullets = [
    `真实问题：${summary}`,
    `目标用户：${targetUser}`,
    `典型场景：Builder Test 截止前一晚 / 工作日午休 / 周末整理想法`,
    `需求真实性风险：是否在没有 AI 也无法解决？是否值得 48 小时投入？`,
  ];

  const markdown = [
    "## Problem Discovery Agent",
    "",
    `**职责**：识别真实问题、目标用户、典型使用场景，评估需求真实性风险。`,
    "",
    "**核心结论**",
    ...bullets.map((b) => `- ${b}`),
    "",
    "**provenance**",
    inputs.map((s) => `- 来自 ${s}`).join("\n"),
  ].join("\n");

  return {
    role: "problem_discovery",
    title: "Problem Discovery Agent",
    responsibility: "识别真实问题、目标用户、使用场景，评估需求真实性风险。",
    inputs,
    mode,
    provider,
    model,
    output: { headline: summary, bullets, markdown },
  };
}

// ---------------------------------------------------------------------------
// 2. Boundary Coach Agent
// ---------------------------------------------------------------------------
function runBoundaryCoach(project: HydratedProject): SubagentReport {
  const { mode, provider, model } = modeAndProvider();
  const b = project.globalMemory.productBoundary;
  const confirmed = !!b.confirmedAt;
  const inputs: ProvenanceSource[] = ["project_data", "global_memory"];
  if (confirmed) inputs.push("step0_boundary");

  const bullets = [
    `目标用户：${b.targetUser || "（待补充）"}`,
    `输入输出：${b.ioShape || "（待补充）"}`,
    `首版范围：${b.notDoing || "（待补充）"}`,
    `自由补充：${b.notes || "（无）"}`,
  ];

  const headline = confirmed
    ? `Step 0 边界已确认：${b.targetUser} · ${b.ioShape}`
    : "Step 0 边界尚未确认，建议先完成 3+1 选项。";

  const markdown = [
    "## Boundary Coach Agent",
    "",
    "**职责**：Step 0 产品边界 3+1（目标用户、输入输出、首版范围、自由补充）。",
    "",
    "**当前状态**",
    `- ${confirmed ? "✅ 已确认" : "🟡 待确认"}`,
    "",
    "**字段**",
    ...bullets.map((b) => `- ${b}`),
    "",
    "**provenance**",
    inputs.map((s) => `- 来自 ${s}`).join("\n"),
  ].join("\n");

  return {
    role: "boundary_coach",
    title: "Boundary Coach Agent",
    responsibility: "Step 0 产品边界 3+1：目标用户 / 输入输出 / 首版范围 / 自由补充。",
    inputs,
    mode,
    provider,
    model,
    output: { headline, bullets, markdown },
    notes: confirmed ? [] : ["边界未确认会导致后续步骤上下文不足。"],
  };
}

// ---------------------------------------------------------------------------
// 3. PRD Agent
// ---------------------------------------------------------------------------
function runPRD(project: HydratedProject): SubagentReport {
  const { mode, provider, model } = modeAndProvider();
  const ready = readyStepIds(project);
  const inputs: ProvenanceSource[] = ["project_data"];
  if (project.globalMemory.productBoundary.confirmedAt) inputs.push("step0_boundary");
  for (const id of ready) inputs.push(`step:${id}`);

  const sectionLine = (id: StepId) => {
    const s = project.steps[id];
    const ok = isReady(s);
    return `- ${STEP_META[id].name}（${STEP_META[id].subtitle}）：${ok ? "✅ ready" : "🟡 pending"}`;
  };

  const bullets = STEP_IDS.map(sectionLine);
  const headline =
    ready.length === 6
      ? "PRD 已 final（6 步全 ready）"
      : `PRD 处于 draft 状态，已 ready ${ready.length}/6 步`;

  const markdown = [
    "## PRD Agent",
    "",
    "**职责**：把 6 步内容聚合成结构化 PRD。",
    "",
    "**6 步 readiness**",
    ...bullets,
    "",
    "**provenance**",
    inputs.map((s) => `- 来自 ${s}`).join("\n"),
  ].join("\n");

  return {
    role: "prd",
    title: "PRD Agent",
    responsibility: "把 6 步内容聚合成结构化 PRD。",
    inputs,
    mode,
    provider,
    model,
    output: { headline, bullets, markdown },
  };
}

// ---------------------------------------------------------------------------
// 4. Build Planner Agent
// ---------------------------------------------------------------------------
function runBuildPlanner(project: HydratedProject): SubagentReport {
  const { mode, provider, model } = modeAndProvider();
  const inputs: ProvenanceSource[] = ["project_data"];
  if (isReady(project.steps.build)) inputs.push("step:build");
  if (isReady(project.steps.mvp)) inputs.push("step:mvp");
  if (isReady(project.steps.ship)) inputs.push("step:ship");

  const haveBuild = isReady(project.steps.build) || isReady(project.steps.mvp);

  const bullets = [
    `技术栈：Vite + React + Express + better-sqlite3 + Tailwind + shadcn/ui`,
    `Day 1：schema + storage + CRUD + Mock 生成 + 引导问答`,
    `Day 2：三卡输出 + Submission Brief + Snapshot + 部署`,
    `任务拆解：${haveBuild ? "已基于 build/mvp 步骤产出" : "等待 build 或 mvp 任一 ready 后会更细"}`,
  ];

  const headline = haveBuild
    ? "README / 技术路径 / 任务清单可生成"
    : "需要 build 或 mvp 至少一步 ready 才能给出完整 README + 任务清单";

  const markdown = [
    "## Build Planner Agent",
    "",
    "**职责**：生成 README、技术路径、任务拆解、48 小时实现计划。",
    "",
    "**核心建议**",
    ...bullets.map((b) => `- ${b}`),
    "",
    "**provenance**",
    inputs.map((s) => `- 来自 ${s}`).join("\n"),
  ].join("\n");

  return {
    role: "build_planner",
    title: "Build Planner Agent",
    responsibility: "生成 README、技术路径、任务拆解、48 小时实现计划。",
    inputs,
    mode,
    provider,
    model,
    output: { headline, bullets, markdown },
  };
}

// ---------------------------------------------------------------------------
// 5. Pitch Agent
// ---------------------------------------------------------------------------
function runPitch(project: HydratedProject): SubagentReport {
  const { mode, provider, model } = modeAndProvider();
  const inputs: ProvenanceSource[] = ["project_data"];
  if (project.globalMemory.productBoundary.confirmedAt) inputs.push("step0_boundary");
  if (isReady(project.steps.mvp)) inputs.push("step:mvp");
  if (isReady(project.steps.ship)) inputs.push("step:ship");
  if (isReady(project.steps.solution)) inputs.push("step:solution");

  const bullets = [
    `Demo 名称：Builder Demo Coach: ${project.name}`,
    `Demo 说明：把「${project.initialIdea}」收敛成可演示 Demo 套件，含 PRD / README / Tasks / 提交说明。`,
    `为什么这个方案：48 小时内必须可演示，AI 把模糊想法收敛成结构化字段比空白文档快 3 倍。`,
    `60 秒 Pitch：从一句话想法 → Step 0 边界 → 6 步问答 → 三卡 + Submission Brief。`,
  ];

  const headline = "已生成小红书 Builder Test 6 字段 + 60 秒 Pitch 草稿";

  const markdown = [
    "## Pitch Agent",
    "",
    "**职责**：生成小红书 Builder Test 提交字段、Demo 说明、60 秒展示稿。",
    "",
    "**核心字段（节选）**",
    ...bullets.map((b) => `- ${b}`),
    "",
    "**provenance**",
    inputs.map((s) => `- 来自 ${s}`).join("\n"),
  ].join("\n");

  return {
    role: "pitch",
    title: "Pitch Agent",
    responsibility: "生成小红书 Builder Test 提交字段、Demo 说明、60 秒展示稿。",
    inputs,
    mode,
    provider,
    model,
    output: { headline, bullets, markdown },
  };
}

// ---------------------------------------------------------------------------
// 6. Validation Agent
// ---------------------------------------------------------------------------
function runValidation(
  project: HydratedProject,
  readiness: {
    prd: { ok: boolean; missing: StepId[] };
    readme: { ok: boolean; missing: StepId[] };
    overviewTasks: { ok: boolean; missing: StepId[] };
    engineeringTasks: { ok: boolean; missing: StepId[] };
    submissionBrief: { ok: boolean; missing: StepId[] };
  },
  demoLinkOk: boolean,
): SubagentReport {
  const { mode, provider, model } = modeAndProvider();
  const inputs: ProvenanceSource[] = ["project_data"];
  if (project.globalMemory.productBoundary.confirmedAt) inputs.push("step0_boundary");
  for (const id of readyStepIds(project)) inputs.push(`step:${id}`);

  const bullets = [
    `PRD：${readiness.prd.ok ? "✅" : "🟡"} 缺失 ${readiness.prd.missing.length} 步`,
    `README：${readiness.readme.ok ? "✅" : "🟡"} 缺失 ${readiness.readme.missing.length} 步`,
    `Tasks（产品概览）：${readiness.overviewTasks.ok ? "✅" : "🟡"}`,
    `Tasks（工程拆解）：${readiness.engineeringTasks.ok ? "✅" : "🟡"}`,
    `Submission Brief：${readiness.submissionBrief.ok ? "✅" : "🟡"}${demoLinkOk ? "" : "（Demo 链接待补充）"}`,
    `Mock/Real provenance：${
      realCapable()
        ? getLLMHealth().lastSucceeded
          ? "本次走 Real LLM 路径，生成不保证可复现"
          : getLLMHealth().lastCallAt
            ? "real-capable，但最近一次调用失败已回落 Mock"
            : "real-capable，尚未发出调用"
        : "纯 Mock 路径，可复现"
    }`,
  ];

  const issues: string[] = [];
  if (!demoLinkOk) issues.push("Demo 链接缺失或为待补充。");
  if (!project.globalMemory.productBoundary.confirmedAt) issues.push("Step 0 边界未确认。");
  for (const id of STEP_IDS) {
    if (!isReady(project.steps[id])) issues.push(`步骤「${STEP_META[id].name}」未 ready。`);
  }

  const headline = issues.length
    ? `发现 ${issues.length} 个问题，建议先补齐再提交`
    : "所有交付物 readiness 通过，可以提交";

  const markdown = [
    "## Validation Agent",
    "",
    "**职责**：检查缺失字段、Mock/Real provenance、Demo 链接、导出物 readiness。",
    "",
    "**结论**",
    `- ${headline}`,
    "",
    "**readiness 概览**",
    ...bullets.map((b) => `- ${b}`),
    "",
    issues.length ? "**待修复**" : "**无待修复项**",
    ...(issues.length ? issues.map((i) => `- ${i}`) : []),
    "",
    "**provenance**",
    inputs.map((s) => `- 来自 ${s}`).join("\n"),
  ].join("\n");

  return {
    role: "validation",
    title: "Validation Agent",
    responsibility: "检查缺失字段、Mock/Real provenance、Demo 链接、导出物 readiness。",
    inputs,
    mode,
    provider,
    model,
    output: { headline, bullets, markdown },
    notes: issues,
  };
}

// ---------------------------------------------------------------------------
// runOrchestrator: 顺序调度 6 个 subagent
// ---------------------------------------------------------------------------
export function runOrchestrator(
  project: HydratedProject,
  readiness: {
    prd: { ok: boolean; missing: StepId[] };
    readme: { ok: boolean; missing: StepId[] };
    overviewTasks: { ok: boolean; missing: StepId[] };
    engineeringTasks: { ok: boolean; missing: StepId[] };
    submissionBrief: { ok: boolean; missing: StepId[] };
  },
  demoLinkOk: boolean,
): SubagentReport[] {
  return [
    runProblemDiscovery(project),
    runBoundaryCoach(project),
    runPRD(project),
    runBuildPlanner(project),
    runPitch(project),
    runValidation(project, readiness, demoLinkOk),
  ];
}
