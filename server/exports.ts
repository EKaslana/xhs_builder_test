import {
  STEP_IDS,
  STEP_META,
  type HydratedProject,
  type StepId,
} from "@shared/schema";

function isReady(s: any): boolean {
  return !!s?.generatedContent && ["generated", "saved", "locked"].includes(s.status);
}

function readyMap(project: HydratedProject): Record<StepId, boolean> {
  const m = {} as Record<StepId, boolean>;
  for (const id of STEP_IDS) m[id] = isReady(project.steps[id]);
  return m;
}

function missingFrom(project: HydratedProject, required: StepId[]): StepId[] {
  return required.filter((id) => !isReady(project.steps[id]));
}

// ---------------------------------------------------------------------------
// PRD
// ---------------------------------------------------------------------------
export function generatePRD(project: HydratedProject): {
  markdown: string;
  mode: "draft" | "final";
  missingSteps: StepId[];
  readySteps: StepId[];
} {
  const missing = missingFrom(project, [...STEP_IDS]);
  const ready = STEP_IDS.filter((id) => isReady(project.steps[id]));
  const mode: "draft" | "final" = missing.length === 0 ? "final" : "draft";
  const b = project.globalMemory.productBoundary;

  const lines: string[] = [];
  lines.push(`# ${project.name} · 产品需求文档（PRD）`);
  lines.push("");
  lines.push(`> 模式：**${mode === "final" ? "Final（6 步全 ready）" : `Draft（缺失 ${missing.length} 步）`}**`);
  lines.push("");
  lines.push("## 0. 一句话定位");
  lines.push("");
  lines.push(`- 项目名：${project.name}`);
  lines.push(`- 一句话想法：${project.initialIdea}`);
  if (project.globalMemory.ideaSummary) {
    lines.push(`- AI 摘要：${project.globalMemory.ideaSummary}`);
  }
  lines.push("");
  lines.push("## Step 0 · 产品边界");
  lines.push("");
  if (b.confirmedAt) {
    lines.push(`- 目标用户：${b.targetUser}`);
    lines.push(`- 输入输出：${b.ioShape}`);
    lines.push(`- 首版范围：${b.notDoing}`);
    if (b.notes) lines.push(`- 自由补充：${b.notes}`);
  } else {
    lines.push("- 边界尚未确认。建议先在 Step 0 完成 3+1 选项。");
  }
  lines.push("");

  for (const id of STEP_IDS) {
    const meta = STEP_META[id];
    const step = project.steps[id];
    lines.push(`## ${meta.name} · ${meta.subtitle}`);
    lines.push("");
    if (isReady(step)) {
      const g = step.generatedContent!;
      lines.push(`**摘要**：${g.summary}`);
      lines.push("");
      if (g.keyQuestions.length) {
        lines.push("**关键问题**");
        g.keyQuestions.forEach((q) => lines.push(`- ${q}`));
        lines.push("");
      }
      lines.push("**分析**");
      lines.push(g.analysis);
      lines.push("");
      if (g.decisions.length) {
        lines.push("**决策**");
        g.decisions.forEach((d) => lines.push(`- ${d}`));
        lines.push("");
      }
      if (g.risks.length) {
        lines.push("**风险**");
        g.risks.forEach((r) => lines.push(`- ${r}`));
        lines.push("");
      }
    } else {
      lines.push(`> 🟡 该步骤尚未生成。`);
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push("_由 Builder Demo Coach · Mock 模式生成_");

  return {
    markdown: lines.join("\n"),
    mode,
    missingSteps: missing,
    readySteps: ready,
  };
}

// ---------------------------------------------------------------------------
// README
// ---------------------------------------------------------------------------
export function generateREADME(project: HydratedProject): { markdown: string; missing: StepId[] } {
  const r = readyMap(project);
  const missing = missingFrom(project, ["build", "ship"]).filter((id) => !r[id]);
  // README ok if at least one of build/ship ready
  const minOK = r.build || r.ship;
  const lines: string[] = [];
  lines.push(`# ${project.name}`);
  lines.push("");
  lines.push(`> ${project.initialIdea}`);
  lines.push("");
  lines.push("## 项目简介");
  lines.push("");
  lines.push(
    `这是一个由 Builder Demo Coach 生成的 48 小时 Demo 项目。围绕 Builder Test 场景，把一句话想法收敛成可演示、可提交的 Demo 套件。`,
  );
  lines.push("");
  if (!minOK) {
    lines.push("> 🟡 README 处于占位状态。完成「实现路径」或「展示迭代」任一步骤后，技术细节会被填充。");
    lines.push("");
  }
  lines.push("## 技术栈");
  lines.push("");
  lines.push("- 前端：React 18 + TypeScript + Vite + wouter + TanStack Query + Tailwind + shadcn/ui");
  lines.push("- 后端：Node 20 + Express 5 + better-sqlite3 + drizzle-orm");
  lines.push("- 端口：5000（前后端同源）");
  lines.push("");
  lines.push("## 快速开始");
  lines.push("");
  lines.push("```bash");
  lines.push("npm install");
  lines.push("npm run dev");
  lines.push("```");
  lines.push("");
  lines.push("## 生产构建");
  lines.push("");
  lines.push("```bash");
  lines.push("npm run build");
  lines.push("NODE_ENV=production node dist/index.cjs");
  lines.push("```");
  lines.push("");
  if (r.build && project.steps.build.generatedContent) {
    lines.push("## 实现路径");
    lines.push("");
    lines.push(project.steps.build.generatedContent.analysis);
    lines.push("");
  }
  if (r.ship && project.steps.ship.generatedContent) {
    lines.push("## 展示与迭代");
    lines.push("");
    lines.push(project.steps.ship.generatedContent.analysis);
    lines.push("");
  }
  lines.push("## Mock / Real 模式");
  lines.push("");
  lines.push("默认走 Mock 本地模板，无需 API key。如需真实 LLM，配置环境变量：");
  lines.push("");
  lines.push("```bash");
  lines.push("USE_REAL_LLM=1");
  lines.push("LLM_API_KEY=sk-...");
  lines.push("LLM_BASE_URL=https://api.perplexity.ai");
  lines.push("LLM_MODEL=sonar-pro");
  lines.push("LLM_PROVIDER=perplexity");
  lines.push("```");
  lines.push("");
  return { markdown: lines.join("\n"), missing };
}

// ---------------------------------------------------------------------------
// Tasks (Overview + Engineering)
// ---------------------------------------------------------------------------
export function generateOverviewTasks(project: HydratedProject): { markdown: string; missing: StepId[] } {
  const missing = missingFrom(project, ["mvp", "build"]);
  const lines: string[] = [];
  lines.push(`# ${project.name} · 产品概览任务清单`);
  lines.push("");
  lines.push("围绕 48 小时 Builder Test 的产品视角任务。");
  lines.push("");
  lines.push("## Day 1");
  lines.push("");
  lines.push("- [ ] 完成 Step 0 边界（目标用户 / 输入输出 / 首版范围）");
  lines.push("- [ ] 完成需求发现（Discovery）问答");
  lines.push("- [ ] 完成问题定义（Definition）问答");
  lines.push("- [ ] 跑通 Mock 生成路径");
  lines.push("");
  lines.push("## Day 2");
  lines.push("");
  lines.push("- [ ] 完成方案设计（Solution）/ MVP 设计");
  lines.push("- [ ] 完成实现路径（Build）/ 展示迭代（Ship）");
  lines.push("- [ ] 导出三卡 + Submission Brief");
  lines.push("- [ ] 准备 Demo 链接（公开部署 / 录屏 / Snapshot JSON）");
  lines.push("- [ ] 完成 60 秒 Pitch 演练");
  lines.push("");
  return { markdown: lines.join("\n"), missing };
}

export function generateEngineeringTasks(project: HydratedProject): { markdown: string; missing: StepId[] } {
  const missing = missingFrom(project, ["mvp", "build"]);
  const lines: string[] = [];
  lines.push(`# ${project.name} · 工程拆解任务清单`);
  lines.push("");
  lines.push("## 后端");
  lines.push("");
  lines.push("- [ ] schema：projects 表 + JSON 列（globalMemory / steps）");
  lines.push("- [ ] storage hydrate：所有新字段使用 .default(...)");
  lines.push("- [ ] /api/projects CRUD");
  lines.push("- [ ] /api/generate：Mock 路径生成 GeneratedContent");
  lines.push("- [ ] /api/qa：next / answer / resolve-conflict / reset");
  lines.push("- [ ] /api/boundary：options / confirm");
  lines.push("- [ ] /api/exports + /api/submission");
  lines.push("- [ ] /api/snapshot 导出 + import");
  lines.push("- [ ] /api/meta/agent-mode 诚实报告 mock/real");
  lines.push("");
  lines.push("## 前端");
  lines.push("");
  lines.push("- [ ] Home + 项目列表 + 创建对话框");
  lines.push("- [ ] BoundaryStep0：3+1 边界");
  lines.push("- [ ] StepEditor：四字段 + 引导问答 + 生成 + 锁定");
  lines.push("- [ ] PRDPreview：三卡 + Submission Brief + Subagent Panel");
  lines.push("- [ ] AgentModeBar / Badge / Footer");
  lines.push("- [ ] Snapshot 导入导出 UI");
  lines.push("");
  return { markdown: lines.join("\n"), missing };
}

// ---------------------------------------------------------------------------
// Submission Brief (Builder Test)
// ---------------------------------------------------------------------------
export type XHSFields = {
  demoName: string;
  demoLink: string;
  demoDescription: string;
  whyThisSolution: string;
  implementationDetails: string;
  learnings: string;
};

export function generateSubmissionBrief(
  project: HydratedProject,
  publicLink?: string,
): {
  markdown: string;
  missing: StepId[];
  xhsFields: XHSFields;
  demoLinkOk: boolean;
} {
  const b = project.globalMemory.productBoundary;
  // Min deps: boundary confirmed + (mvp or ship) ready
  const missing: StepId[] = [];
  if (!b.confirmedAt) {
    // boundary missing — represented by no specific step id; we still flag in readiness
  }
  if (!isReady(project.steps.mvp) && !isReady(project.steps.ship)) {
    missing.push("mvp");
  }

  const demoLink = (publicLink || "").trim();
  const demoLinkOk = !!demoLink && /^https?:\/\//.test(demoLink);

  const xhsFields: XHSFields = {
    demoName: `Builder Demo Coach: ${project.name}`,
    demoLink: demoLinkOk ? demoLink : "（待补充公开链接）",
    demoDescription: [
      `${project.name} 是一个面向 48 小时 Builder Test 的 AI 产品教练。`,
      `用户输入一句话想法，工具引导确认产品边界（Step 0），并通过 6 个工作步骤的 3+1 chip 化问答收敛想法。`,
      `最终一键导出 PRD / README / Tasks / Builder Test Submission Brief 四份 Markdown 套件。`,
      `面向产品小白与 Builder Test 候选人。`,
    ].join("\n"),
    whyThisSolution: [
      `观察到的真实痛点：48 小时 Builder Test 中候选人最大的成本不是写代码，而是把模糊想法收敛成可演示的产品。`,
      `选择 AI 而不是普通模板，是因为模板无法贴合用户的具体想法；选择 Mock 默认可用，是因为 Builder Test 不允许 Demo 因为 API 故障而崩。`,
      `Step 0 边界 + 6 步问答 + 3+1 选项的组合，让产品小白不需要"写"，只需要"选"，把决策成本降到最低。`,
    ].join("\n"),
    implementationDetails: [
      `技术栈：Vite + React + Express + better-sqlite3 + Tailwind + shadcn/ui，端口 5000 同源托管。`,
      `Agent 设计：Orchestrator 顺序调度 6 个 Subagent —— Problem Discovery / Boundary Coach / PRD / Build Planner / Pitch / Validation。每个 subagent 输出携带 provenance（来源数据 / Step 0 边界 / 6 步内容），可追溯。`,
      `Prompt 思路：v1 全 Mock 模板（确定性、可复现）；Round 13 接入 OpenAI-compatible 协议（Perplexity / DeepSeek / OpenAI）。`,
      `关键设计决策：服务端即时保存（每次 QA 答案都写库）+ Snapshot JSON 导出导入（解决跨实例丢失），不依赖浏览器存储。`,
      `卡点与绕法：SQLite 不支持数组列 → JSON.stringify + 反序列化时套用 zod .default(...)；Schema 演进采用 additive evolution，旧项目可平滑 hydrate。`,
    ].join("\n"),
    learnings: [
      `做完后才发现：产品小白真正缺的不是"AI 能力"，是"被引导的勇气"——3+1 选项把"什么都行"变成"四选一"，决策门槛骤降。`,
      `honest provenance（Mock/Real 状态条 + Subagent 来源标注）反而提升了用户信任，用户更愿意把 AI 当合作者而不是黑盒。`,
      `下一轮可深挖：① 接入真实 LLM 后 Subagent 之间的 hand-off prompt 设计；② 让 Validation Agent 不仅检查字段，还能给出修复建议；③ 增加多语言版本以适配更多 Builder Test。`,
    ].join("\n"),
  };

  const lines: string[] = [];
  lines.push(`# ${project.name} · Builder Test Submission Brief`);
  lines.push("");
  lines.push(`> 适用于：小红书 Red Finance Trainee Builder Test / 48 小时 Demo`);
  lines.push("");
  lines.push("## 提交字段（小红书 6 字段）");
  lines.push("");
  lines.push(`### AI Demo 名称`);
  lines.push(xhsFields.demoName);
  lines.push("");
  lines.push(`### Demo 链接`);
  lines.push(xhsFields.demoLink);
  if (!demoLinkOk) {
    lines.push("");
    lines.push("> 🟡 需要补一个能直接打开看到作品的地址（部署站点 / 仓库 / 录屏 / 公开页面）。");
  }
  lines.push("");
  lines.push(`### Demo 说明`);
  lines.push(xhsFields.demoDescription);
  lines.push("");
  lines.push(`### 为什么做这个解决方案`);
  lines.push(xhsFields.whyThisSolution);
  lines.push("");
  lines.push(`### 具体是怎么实现的`);
  lines.push(xhsFields.implementationDetails);
  lines.push("");
  lines.push(`### 做完之后有没有新的启发和发现`);
  lines.push(xhsFields.learnings);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 60 秒 Pitch Script");
  lines.push("");
  lines.push(
    `各位好，我做的是「${project.name}」——一个面向 48 小时 Builder Test 的 AI 产品教练。`,
  );
  lines.push("");
  lines.push(
    "用户的痛点是：模糊想法太多，但 48 小时内交付不出 Demo。我的解法分三步：第一，Step 0 边界把目标用户 / 输入输出 / 首版范围三选一确认；第二，6 个工作步骤每步只问 3+1 个 chip 化问题；第三，最终一键导出 PRD / README / Tasks 加 Builder Test 提交说明。",
  );
  lines.push("");
  lines.push(
    "技术上 Mock 默认可用，状态条诚实告知 Mock/Real 来源；后端用了多 Agent 编排，6 个 Subagent 各司其职，每个输出都可追溯到原始项目数据。",
  );
  lines.push("");
  lines.push("48 小时之后我学到最重要的一件事是：产品小白真正缺的不是 AI，是被引导的勇气。谢谢。");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Mock / Real Provenance");
  lines.push("");
  lines.push(
    `本次 Submission Brief 由 Mock 本地模板生成，可复现。Real 模式接入后会通过 \`/api/meta/agent-mode\` 诚实报告。`,
  );

  return {
    markdown: lines.join("\n"),
    missing,
    xhsFields,
    demoLinkOk,
  };
}

export type ExportsResponse = {
  prd: { markdown: string; mode: "draft" | "final"; missing: StepId[] };
  readme: { markdown: string; missing: StepId[] };
  overviewTasks: { markdown: string; missing: StepId[] };
  engineeringTasks: { markdown: string; missing: StepId[] };
  submissionBrief: {
    markdown: string;
    missing: StepId[];
    xhsFields: XHSFields;
  };
  readiness: {
    prd: { ok: boolean; missing: StepId[] };
    readme: { ok: boolean; missing: StepId[] };
    overviewTasks: { ok: boolean; missing: StepId[] };
    engineeringTasks: { ok: boolean; missing: StepId[] };
    submissionBrief: { ok: boolean; missing: StepId[] };
  };
};

export function buildExports(
  project: HydratedProject,
  publicLink?: string,
): ExportsResponse & { demoLinkOk: boolean } {
  const prd = generatePRD(project);
  const readme = generateREADME(project);
  const overviewTasks = generateOverviewTasks(project);
  const engineeringTasks = generateEngineeringTasks(project);
  const sb = generateSubmissionBrief(project, publicLink);
  const r = readyMap(project);

  const readiness = {
    prd: { ok: prd.mode === "final", missing: prd.missingSteps },
    readme: { ok: r.build || r.ship, missing: readme.missing },
    overviewTasks: { ok: r.mvp || r.build, missing: overviewTasks.missing },
    engineeringTasks: { ok: r.mvp || r.build, missing: engineeringTasks.missing },
    submissionBrief: {
      ok: !!project.globalMemory.productBoundary.confirmedAt && (r.mvp || r.ship) && sb.demoLinkOk,
      missing: sb.missing,
    },
  };

  return {
    prd: { markdown: prd.markdown, mode: prd.mode, missing: prd.missingSteps },
    readme,
    overviewTasks,
    engineeringTasks,
    submissionBrief: {
      markdown: sb.markdown,
      missing: sb.missing,
      xhsFields: sb.xhsFields,
    },
    readiness,
    demoLinkOk: sb.demoLinkOk,
  };
}
