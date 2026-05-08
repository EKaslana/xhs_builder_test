import {
  STEP_META,
  STEP_MIN_QUESTIONS,
  STEP_MAX_QUESTIONS,
  type GeneratedContent,
  type HydratedProject,
  type StepId,
  type StepQAItem,
} from "@shared/schema";

// ============================================================================
// Types
// ============================================================================
export type NextQuestion = {
  questionId: string;
  question: string;
  targetField: "userInput" | "constraints" | "extensionSpace" | "memory";
  options: string[];
  optionInsights?: Record<string, string>;
  dimensionLabel?: string;
  dimensionMode: "single-axis" | "priority";
  rationale?: string;
};

export type QAConflict = {
  priorQuestionId: string;
  priorQuestion: string;
  priorAnswer: string;
  newAnswer: string;
  reason: string;
};

export type BoundaryOptions = {
  targetUser: { options: string[]; insights: Record<string, string> };
  ioShape: { options: string[]; insights: Record<string, string> };
  notDoing: { options: string[]; insights: Record<string, string> };
};

// ============================================================================
// Agent mode helpers
// ============================================================================
export function realCapable(): boolean {
  return process.env.USE_REAL_LLM === "1" && !!process.env.LLM_API_KEY;
}

export function getProvider(): {
  provider: "local" | "perplexity" | "deepseek" | "openai" | "custom";
  model: string;
  baseUrl: string;
} {
  if (!realCapable()) {
    return { provider: "local", model: "本地模板", baseUrl: "" };
  }
  const provider =
    (process.env.LLM_PROVIDER as any) ||
    (() => {
      const url = process.env.LLM_BASE_URL || "";
      if (url.includes("perplexity")) return "perplexity";
      if (url.includes("deepseek")) return "deepseek";
      if (url.includes("openai.com")) return "openai";
      return "custom";
    })();
  return {
    provider,
    model: process.env.LLM_MODEL || "unknown",
    baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
  };
}

// ============================================================================
// Real LLM — OpenAI-compatible chat completion with JSON-mode response
//
// Supports Perplexity / DeepSeek / OpenAI / any custom OpenAI-compatible
// endpoint via LLM_BASE_URL. Activated only when realCapable() is true; every
// call reports success/failure to the module-level health flag so the
// /api/meta/agent-mode endpoint can show live state to the frontend.
// ============================================================================

// Health state (module-private). Refreshed by every callRaw().
let _lastSucceeded = false;
let _lastCallAt: number | null = null;
let _lastError: string | null = null;

export function getLLMHealth(): {
  lastSucceeded: boolean;
  lastCallAt: number | null;
  lastError: string | null;
} {
  return { lastSucceeded: _lastSucceeded, lastCallAt: _lastCallAt, lastError: _lastError };
}

export type LLMCallOptions = {
  systemPrompt?: string;
  temperature?: number;
  timeoutMs?: number;
  maxRetries?: number;
  // If provided, the model is instructed to return JSON matching this shape
  // (described as a JSON-Schema-style object). The raw JSON is returned as-is.
  jsonSchema?: Record<string, unknown> | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function extractJsonString(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Strip ```json fences if present
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  // Otherwise grab from first { to last }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

/**
 * Low-level OpenAI-compatible call. Returns a raw JSON object parsed from
 * the assistant message, or null on any failure. Logs failures via _lastError.
 */
async function callRaw(
  userPrompt: string,
  opts: LLMCallOptions = {},
): Promise<Record<string, any> | null> {
  if (!realCapable()) return null;

  const provider = getProvider();
  const apiKey = process.env.LLM_API_KEY!;
  const url = provider.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const timeoutMs = opts.timeoutMs ?? Number(process.env.LLM_TIMEOUT_MS || 25000);
  const maxRetries = opts.maxRetries ?? Number(process.env.LLM_MAX_RETRIES || 2);
  const temperature =
    opts.temperature ?? (process.env.LLM_TEMPERATURE ? Number(process.env.LLM_TEMPERATURE) : 0.4);

  const messages: Array<{ role: string; content: string }> = [];
  if (opts.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  if (opts.jsonSchema) {
    messages.push({
      role: "system",
      content:
        "You MUST respond with a single JSON object that conforms to this shape:\n" +
        JSON.stringify(opts.jsonSchema) +
        "\nNo prose, no markdown — only the JSON object.",
    });
  }
  messages.push({ role: "user", content: userPrompt });

  const body: Record<string, any> = {
    model: provider.model,
    messages,
    temperature,
  };
  if (opts.jsonSchema) {
    // Ask for JSON mode where supported (OpenAI / DeepSeek). Perplexity
    // ignores unknown fields, so this is harmless when unsupported.
    body.response_format = { type: "json_object" };
  }
  if (process.env.LLM_SEED) body.seed = Number(process.env.LLM_SEED);

  let lastErr = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      // 429 or 5xx → exponential backoff retry
      if (resp.status === 429 || (resp.status >= 500 && resp.status < 600)) {
        lastErr = `HTTP ${resp.status}`;
        if (attempt < maxRetries) {
          // Honor Retry-After if present, else exponential 500/1000/2000ms
          const retryAfter = Number(resp.headers.get("retry-after") || 0);
          const backoff = retryAfter > 0 ? retryAfter * 1000 : 500 * Math.pow(2, attempt);
          await sleep(backoff);
          continue;
        }
        break;
      }
      if (!resp.ok) {
        lastErr = `HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`;
        break;
      }

      const data: any = await resp.json();
      const content: string = data?.choices?.[0]?.message?.content ?? "";
      const jsonText = extractJsonString(content);
      if (!jsonText) {
        lastErr = "empty response";
        break;
      }
      try {
        const parsed = JSON.parse(jsonText);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          _lastSucceeded = true;
          _lastCallAt = Date.now();
          _lastError = null;
          return parsed as Record<string, any>;
        }
        lastErr = "non-object JSON";
        break;
      } catch (e: any) {
        lastErr = `JSON parse failed: ${e?.message || e}`;
        break;
      }
    } catch (e: any) {
      clearTimeout(timer);
      lastErr = e?.name === "AbortError" ? "timeout" : `network: ${e?.message || e}`;
      // Network / timeout → retry up to maxRetries
      if (attempt < maxRetries) {
        await sleep(500 * Math.pow(2, attempt));
        continue;
      }
      break;
    }
  }

  _lastSucceeded = false;
  _lastCallAt = Date.now();
  _lastError = lastErr || "unknown";
  // eslint-disable-next-line no-console
  console.warn(`[llm] call failed: ${_lastError} → falling back to mock`);
  return null;
}

/**
 * Public step-content entry point. Kept for backwards compatibility — orchestrator
 * imports `callLLM` and treats null as "fall back to mock".
 */
export async function callLLM(
  prompt: string,
  schema?: Record<string, unknown> | null,
): Promise<GeneratedContent | null> {
  if (!realCapable()) return null;
  const raw = await callRaw(prompt, {
    systemPrompt:
      "You are Builder Demo Coach, a senior product coach helping someone ship a 48-hour AI demo. Reply in the same language as the user (Chinese unless told otherwise). Be concrete, decision-oriented, and respect the project's Step 0 boundary.",
    jsonSchema: schema || GENERATED_CONTENT_SCHEMA,
  });
  if (!raw) return null;
  return coerceGeneratedContent(raw);
}

// ----------------------------------------------------------------------------
// JSON Schemas for the three real-LLM entry points
// ----------------------------------------------------------------------------
const SUMMARY_SCHEMA = {
  summary: "string — one sentence, <=80 chars, starts with project name + colon",
  tags: "string[] — 2 to 4 short Chinese tags",
};

const NEXT_QUESTION_SCHEMA = {
  question: "string — one specific Chinese question for this step",
  options: "string[] — exactly 3 mutually-exclusive options on the same dimension",
  optionInsights: "object<string,string> — short rationale for each option",
  dimensionLabel: "string — short label of the dimension (e.g. 用户范围)",
  targetField: "string — one of: userInput | constraints | extensionSpace | memory",
  rationale: "string — short reason this question matters now",
};

const GENERATED_CONTENT_SCHEMA = {
  summary: "string — one paragraph, opens with [STEP_NAME · SUBTITLE]",
  keyQuestions: "string[] — 3 sharp questions about this step",
  analysis: "string — markdown body, headings allowed",
  suggestedOutput: "object — step-specific structured fields",
  risks: "string[] — 2 to 4 concrete risks",
  decisions: "string[] — 2 to 4 decisions captured this step",
  extensionSpace: "string[] — 2 to 4 extension ideas saved for later",
  nextStepHint: "string — one sentence pointing to the next step",
};

// ----------------------------------------------------------------------------
// Type-safe coercers (the LLM may return slightly off shapes — clamp them)
// ----------------------------------------------------------------------------
function asStringArray(v: any, fallback: string[] = []): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string" && x.trim()).slice(0, 8);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return fallback;
}
function asString(v: any, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function coerceGeneratedContent(raw: Record<string, any>): GeneratedContent | null {
  const summary = asString(raw.summary);
  if (!summary) return null;
  return {
    summary,
    keyQuestions: asStringArray(raw.keyQuestions),
    analysis: asString(raw.analysis, summary),
    suggestedOutput:
      raw.suggestedOutput && typeof raw.suggestedOutput === "object" && !Array.isArray(raw.suggestedOutput)
        ? raw.suggestedOutput
        : {},
    risks: asStringArray(raw.risks),
    decisions: asStringArray(raw.decisions),
    extensionSpace: asStringArray(raw.extensionSpace),
    nextStepHint: asString(raw.nextStepHint),
    userEdited: {},
    touchedFields: [],
  };
}

// ----------------------------------------------------------------------------
// Domain-specific real-LLM entry points (each returns null on any failure)
// ----------------------------------------------------------------------------
async function realSummarize(
  idea: string,
  projectName: string,
): Promise<{ summary: string; tags: string[] } | null> {
  if (!realCapable()) return null;
  const prompt =
    `项目名：${projectName}\n` +
    `一句话想法：${idea}\n\n` +
    `请用一句不超过 80 个汉字的中文概括，格式为「${projectName}：……」，并给出 2-4 个简短中文标签。`;
  const raw = await callRaw(prompt, {
    systemPrompt:
      "You are Builder Demo Coach. Summarize a one-line product idea into a tight Chinese sentence + tags.",
    jsonSchema: SUMMARY_SCHEMA,
    temperature: 0.2,
  });
  if (!raw) return null;
  const summary = asString(raw.summary);
  if (!summary) return null;
  let tags = asStringArray(raw.tags);
  tags = tags.slice(0, 4);
  if (tags.length === 0) tags = ["AI", "Demo"];
  return { summary, tags };
}

async function realNextQuestion(
  project: HydratedProject,
  stepId: StepId,
  qaList: StepQAItem[],
): Promise<NextQuestion | null> {
  if (!realCapable()) return null;
  const meta = STEP_META[stepId];
  const boundary = project.globalMemory.productBoundary;
  const askedSummary =
    qaList
      .map(
        (q, i) =>
          `${i + 1}. ${q.question} → 选 [${q.selectedOptions.join("、") || "—"}]${q.freeText ? "；自由补充：" + q.freeText : ""}`,
      )
      .join("\n") || "（暂无）";
  const prompt =
    `当前步骤：${meta.name} · ${meta.subtitle}\n` +
    `项目：${project.name} —— ${project.initialIdea}\n` +
    `Step 0 边界：目标用户「${boundary.targetUser || "—"}」/ 输入输出「${boundary.ioShape || "—"}」/ 首版范围「${boundary.notDoing || "—"}」\n\n` +
    `已答（${qaList.length}/${STEP_MIN_QUESTIONS} 最小）：\n${askedSummary}\n\n` +
    `请基于以上信息，给出本步骤的下一个引导问题（中文）。要求：\n` +
    `- 同维度三个互斥选项 + 用户可自由补充\n` +
    `- 不要重复已经问过的问题\n` +
    `- 选项尽量贴合 48 小时 Builder Test 的真实约束\n` +
    `- targetField 必须是以下之一：userInput / constraints / extensionSpace / memory`;
  const raw = await callRaw(prompt, {
    systemPrompt:
      "You are Builder Demo Coach guiding the user through structured Q&A for a 6-step product flow.",
    jsonSchema: NEXT_QUESTION_SCHEMA,
    temperature: 0.5,
  });
  if (!raw) return null;
  const question = asString(raw.question);
  const options = asStringArray(raw.options).slice(0, 3);
  if (!question || options.length < 2) return null;
  const targetFieldRaw = asString(raw.targetField, "userInput");
  const targetField = (["userInput", "constraints", "extensionSpace", "memory"] as const).includes(
    targetFieldRaw as any,
  )
    ? (targetFieldRaw as NextQuestion["targetField"])
    : "userInput";
  const insights: Record<string, string> = {};
  if (raw.optionInsights && typeof raw.optionInsights === "object" && !Array.isArray(raw.optionInsights)) {
    for (const k of Object.keys(raw.optionInsights)) {
      if (typeof raw.optionInsights[k] === "string") insights[k] = raw.optionInsights[k];
    }
  }
  return {
    questionId: `${stepId}-llm-${qaList.length + 1}`,
    question,
    targetField,
    options,
    optionInsights: insights,
    dimensionLabel: asString(raw.dimensionLabel) || undefined,
    dimensionMode: "single-axis",
    rationale: asString(raw.rationale) || meta.description,
  };
}

async function realStepGenerate(
  project: HydratedProject,
  stepId: StepId,
): Promise<GeneratedContent | null> {
  if (!realCapable()) return null;
  const meta = STEP_META[stepId];
  const step = project.steps[stepId];
  const boundary = project.globalMemory.productBoundary;
  const fields = step.userInput || step.constraints || step.extensionSpace
    ? {
        userInput: step.userInput,
        constraints: step.constraints,
        extensionSpace: step.extensionSpace,
        memory: step.memory,
      }
    : projectAnswersToFields(step.qa);
  const priorReady = (Object.values(project.steps) as any[])
    .filter(
      (s: any) =>
        s.id !== stepId &&
        s.generatedContent &&
        ["generated", "saved", "locked"].includes(s.status),
    )
    .map((s: any) => `- ${STEP_META[s.id as StepId].name}：${s.generatedContent.summary}`)
    .join("\n") || "（无）";
  const prompt =
    `当前步骤：${meta.name} · ${meta.subtitle}\n` +
    `项目：${project.name} —— ${project.initialIdea}\n` +
    `Step 0 边界：目标用户「${boundary.targetUser || "—"}」/ 输入输出「${boundary.ioShape || "—"}」/ 首版范围「${boundary.notDoing || "—"}」\n\n` +
    `本步用户输入：${fields.userInput || "（暂无）"}\n` +
    `约束：${fields.constraints || "（暂无）"}\n` +
    `扩展空间：${fields.extensionSpace || "（暂无）"}\n` +
    `记忆：${fields.memory || "（暂无）"}\n\n` +
    `已 ready 的前置步骤：\n${priorReady}\n\n` +
    `请输出本步骤的结构化结论：summary / keyQuestions / analysis / suggestedOutput / risks / decisions / extensionSpace / nextStepHint。` +
    `summary 必须以「[${meta.name} · ${meta.subtitle}]」开头。`;
  const raw = await callRaw(prompt, {
    systemPrompt:
      "You are Builder Demo Coach. Convert messy step inputs into a tight, decision-ready structured output for a 48-hour build.",
    jsonSchema: GENERATED_CONTENT_SCHEMA,
    temperature: 0.4,
  });
  if (!raw) return null;
  return coerceGeneratedContent(raw);
}

// ============================================================================
// Idea summarization — real-LLM first, fall back to template
// ============================================================================
export async function summarizeIdea(
  idea: string,
  projectName: string,
): Promise<{ summary: string; tags: string[] }> {
  const real = await realSummarize(idea, projectName);
  if (real) return real;
  return mockSummarizeIdea(idea, projectName);
}

export function mockSummarizeIdea(
  idea: string,
  projectName: string,
): { summary: string; tags: string[] } {
  const trimmed = idea.trim().replace(/\s+/g, " ");
  const summary =
    trimmed.length > 80
      ? `${projectName}：${trimmed.slice(0, 76)}…`
      : `${projectName}：${trimmed}`;
  // crude tag extraction
  const candidates = ["AI", "笔记", "整理", "效率", "学习", "写作", "总结", "Demo", "工具", "助手"];
  const tags = candidates
    .filter((c) => trimmed.includes(c) || projectName.includes(c))
    .slice(0, 4);
  if (tags.length === 0) tags.push("AI", "Demo");
  return { summary, tags };
}

// ============================================================================
// Boundary options (Step 0)
// ============================================================================
export function buildBoundaryOptions(_project: HydratedProject): BoundaryOptions {
  return {
    targetUser: {
      options: [
        "单人浏览器场景的产品小白",
        "48 小时 Builder Test 候选人",
        "想把模糊想法变成 Demo 的产品同学",
      ],
      insights: {
        "单人浏览器场景的产品小白": "首版聚焦单人浏览器闭环，账号与协作能力留作后续扩展。",
        "48 小时 Builder Test 候选人": "目标是在两天内交付可演示的 Demo，需要可复制的提交字段。",
        "想把模糊想法变成 Demo 的产品同学": "重点是把一句话想法收敛到具体输入输出。",
      },
    },
    ioShape: {
      options: [
        "输入一句话想法，输出 PRD/README/Tasks/Submission Brief",
        "输入 6 步问答，输出可下载 Markdown 套件",
        "输入边界 + 6 步内容，输出 Builder Test 提交说明",
      ],
      insights: {
        "输入一句话想法，输出 PRD/README/Tasks/Submission Brief": "覆盖整个流程的最常见路径。",
        "输入 6 步问答，输出可下载 Markdown 套件": "强调结构化引导问答与可复制输出。",
        "输入边界 + 6 步内容，输出 Builder Test 提交说明": "聚焦 Builder Test 提交场景。",
      },
    },
    notDoing: {
      options: [
        "首版聚焦单人浏览器闭环",
        "首版聚焦 Markdown 套件输出",
        "首版以 Mock 模板为默认，后接真实 LLM",
      ],
      insights: {
        "首版聚焦单人浏览器闭环": "账号、协作与实时同步留作后续扩展。",
        "首版聚焦 Markdown 套件输出": "Figma、视频或后端服务模板留到后续迭代。",
        "首版以 Mock 模板为默认，后接真实 LLM": "Mock 默认可用，真实模型可切换。",
      },
    },
  };
}

// ============================================================================
// Per-step question banks
// ============================================================================
type QBank = {
  question: string;
  targetField: NextQuestion["targetField"];
  options: string[];
  insights: Record<string, string>;
  dimensionLabel: string;
}[];

const STEP_QUESTIONS: Record<StepId, QBank> = {
  discovery: [
    {
      question: "这个想法最想解决的真实问题是什么？",
      targetField: "userInput",
      options: [
        "用户面对碎片信息无法收敛",
        "用户做完事情没有可展示的产物",
        "用户在 48 小时内要交付 Demo 但缺方法",
      ],
      insights: {
        "用户面对碎片信息无法收敛": "强调信息整理能力。",
        "用户做完事情没有可展示的产物": "强调输出可见性。",
        "用户在 48 小时内要交付 Demo 但缺方法": "强调 Builder Test 时间压力。",
      },
      dimensionLabel: "真实问题",
    },
    {
      question: "目标用户最频繁出现的使用场景是？",
      targetField: "memory",
      options: [
        "周末在家收敛一个想法",
        "工作日午休前后的零碎时间",
        "Builder Test 截止前一晚",
      ],
      insights: {
        "周末在家收敛一个想法": "节奏放松，希望被引导。",
        "工作日午休前后的零碎时间": "短时间、强目标。",
        "Builder Test 截止前一晚": "极强时间压力，需要直出可提交内容。",
      },
      dimensionLabel: "使用场景",
    },
  ],
  definition: [
    {
      question: "首版要稳定输出的核心交付物是？",
      targetField: "userInput",
      options: [
        "PRD / README / Tasks 三件套",
        "三件套 + Builder Test 提交说明",
        "三件套 + 60 秒 Pitch 脚本",
      ],
      insights: {
        "PRD / README / Tasks 三件套": "回到产品文档的本职。",
        "三件套 + Builder Test 提交说明": "服务 Builder Test 直接提交。",
        "三件套 + 60 秒 Pitch 脚本": "服务现场展示。",
      },
      dimensionLabel: "核心交付",
    },
    {
      question: "用户输入最少要满足什么？",
      targetField: "constraints",
      options: [
        "一句话想法 + 项目名",
        "想法 + 边界三选一",
        "想法 + 边界 + 6 步问答",
      ],
      insights: {
        "一句话想法 + 项目名": "最低门槛，靠 Mock 兜底。",
        "想法 + 边界三选一": "保证 Step 0 边界先行。",
        "想法 + 边界 + 6 步问答": "完整 6+1 流程。",
      },
      dimensionLabel: "最小输入",
    },
  ],
  solution: [
    {
      question: "AI 在方案中扮演的核心角色是？",
      targetField: "userInput",
      options: [
        "把模糊想法压缩成结构化字段",
        "为每一步生成可复制的 Markdown",
        "诚实告知 Mock/Real 来源",
      ],
      insights: {
        "把模糊想法压缩成结构化字段": "AI 做收敛。",
        "为每一步生成可复制的 Markdown": "AI 做产出。",
        "诚实告知 Mock/Real 来源": "AI 做 provenance。",
      },
      dimensionLabel: "AI 角色",
    },
    {
      question: "哪些工作不交给 AI？",
      targetField: "constraints",
      options: [
        "用户原始想法的最终决策",
        "Builder Test 提交链接的真实有效性",
        "锁定步骤的覆盖写入",
      ],
      insights: {
        "用户原始想法的最终决策": "AI 提建议，不替用户拍板。",
        "Builder Test 提交链接的真实有效性": "AI 不能编造 Demo 链接。",
        "锁定步骤的覆盖写入": "锁定后 AI 不能再改。",
      },
      dimensionLabel: "AI 边界",
    },
  ],
  mvp: [
    {
      question: "MVP 必须保留的最小闭环是？",
      targetField: "userInput",
      options: [
        "创建项目 → 边界 → 6 步 → 三卡输出",
        "创建项目 → 边界 → 任一步生成 → Submission Brief",
        "导入 Snapshot → 直接看输出",
      ],
      insights: {
        "创建项目 → 边界 → 6 步 → 三卡输出": "完整路径。",
        "创建项目 → 边界 → 任一步生成 → Submission Brief": "最短演示路径。",
        "导入 Snapshot → 直接看输出": "演示恢复能力。",
      },
      dimensionLabel: "最小闭环",
    },
    {
      question: "首版可以压掉哪一类成本？",
      targetField: "extensionSpace",
      options: [
        "登录与多人协作",
        "真实 LLM 接入",
        "复杂样式系统",
      ],
      insights: {
        "登录与多人协作": "明确不做。",
        "真实 LLM 接入": "Round 13 再做。",
        "复杂样式系统": "用 shadcn 兜底。",
      },
      dimensionLabel: "首版压缩",
    },
  ],
  build: [
    {
      question: "技术栈优先选择？",
      targetField: "userInput",
      options: [
        "Vite + Express + SQLite（本规格）",
        "Next.js 全栈",
        "纯前端 + LocalStorage",
      ],
      insights: {
        "Vite + Express + SQLite（本规格）": "符合 v2 规格。",
        "Next.js 全栈": "另一种全栈选择。",
        "纯前端 + LocalStorage": "轻量，但需要交付服务端持久化与 Snapshot 能力时需额外补齐。",
      },
      dimensionLabel: "技术栈",
    },
    {
      question: "48 小时如何分配？",
      targetField: "constraints",
      options: [
        "Day1 后端 + schema，Day2 前端 + 输出",
        "Day1 端到端 Mock 跑通，Day2 打磨 UI",
        "Day1 三卡输出，Day2 Submission Brief 与 Snapshot",
      ],
      insights: {
        "Day1 后端 + schema，Day2 前端 + 输出": "稳健路径。",
        "Day1 端到端 Mock 跑通，Day2 打磨 UI": "保 Demo 优先。",
        "Day1 三卡输出，Day2 Submission Brief 与 Snapshot": "保提交字段优先。",
      },
      dimensionLabel: "时间分配",
    },
  ],
  ship: [
    {
      question: "Demo 的展示方式是？",
      targetField: "userInput",
      options: [
        "公开部署链接 + 60 秒 Pitch",
        "录屏 + Submission Brief",
        "本地启动 + Snapshot JSON 演示",
      ],
      insights: {
        "公开部署链接 + 60 秒 Pitch": "最适合小红书提交。",
        "录屏 + Submission Brief": "稳健的兜底方式。",
        "本地启动 + Snapshot JSON 演示": "现场互动展示。",
      },
      dimensionLabel: "展示方式",
    },
    {
      question: "下一轮迭代会优先做什么？",
      targetField: "extensionSpace",
      options: [
        "接入真实 LLM（Perplexity/DeepSeek/OpenAI）",
        "增加更多导出格式（PDF / 飞书）",
        "为 Submission Brief 增加多语言版本",
      ],
      insights: {
        "接入真实 LLM（Perplexity/DeepSeek/OpenAI）": "Round 13 计划。",
        "增加更多导出格式（PDF / 飞书）": "扩展导出能力。",
        "为 Submission Brief 增加多语言版本": "扩展语言能力。",
      },
      dimensionLabel: "下一轮",
    },
  ],
};

// ============================================================================
// nextQuestionFor — real-LLM first, fall back to question bank
// ============================================================================
export async function nextQuestionFor(
  project: HydratedProject,
  stepId: StepId,
  qaList: StepQAItem[],
): Promise<NextQuestion | null> {
  // Don't ask the LLM after we already hit the max — the bank logic decides done.
  if (qaList.length < STEP_MAX_QUESTIONS) {
    const real = await realNextQuestion(project, stepId, qaList);
    if (real) return real;
  }
  return mockNextQuestion(stepId, qaList);
}

export function mockNextQuestion(
  stepId: StepId,
  qaList: StepQAItem[],
): NextQuestion | null {
  const bank = STEP_QUESTIONS[stepId];
  const askedIds = new Set(qaList.map((q) => q.questionId));
  // questionIds are stable: stepId-index
  for (let i = 0; i < bank.length; i++) {
    const qid = `${stepId}-q${i + 1}`;
    if (!askedIds.has(qid)) {
      const item = bank[i];
      return {
        questionId: qid,
        question: item.question,
        targetField: item.targetField,
        options: item.options,
        optionInsights: item.insights,
        dimensionLabel: item.dimensionLabel,
        dimensionMode: "single-axis",
        rationale: STEP_META[stepId].description,
      };
    }
  }
  // hit min, no more questions
  if (qaList.length >= STEP_MIN_QUESTIONS) return null;
  return null;
}

export function shouldBeComplete(qaList: StepQAItem[]): boolean {
  return qaList.length >= STEP_MIN_QUESTIONS;
}

// ============================================================================
// Conflict detection (semantic-aware mock)
// ============================================================================
const INCLUSION_PAIRS: [string, string][] = [
  ["单人", "首版仅服务单人"],
  ["单人", "单人浏览器场景"],
  ["首版仅", "单人"],
];

function isIncluded(a: string, b: string): boolean {
  for (const [x, y] of INCLUSION_PAIRS) {
    if ((a.includes(x) && b.includes(y)) || (a.includes(y) && b.includes(x))) {
      return true;
    }
  }
  return false;
}

const CONFLICT_AXES: Array<{ axis: string; values: string[] }> = [
  { axis: "scale", values: ["单人", "多人协作", "团队"] },
  { axis: "modality", values: ["浏览器", "原生 App", "桌面客户端"] },
  { axis: "model", values: ["Mock", "真实 LLM", "Real"] },
];

export async function detectConflict(
  qaList: StepQAItem[],
  newAnswer: string,
  targetField: NextQuestion["targetField"],
): Promise<QAConflict | null> {
  for (const prior of qaList) {
    if (prior.targetField !== targetField) continue;
    const priorAnswer = [
      ...prior.selectedOptions,
      prior.freeText || "",
    ].join(" ");
    if (!priorAnswer.trim()) continue;
    if (isIncluded(priorAnswer, newAnswer)) continue;
    for (const { axis, values } of CONFLICT_AXES) {
      const priorMatches = values.filter((v) => priorAnswer.includes(v));
      const newMatches = values.filter((v) => newAnswer.includes(v));
      if (priorMatches.length && newMatches.length) {
        const overlap = priorMatches.some((m) => newMatches.includes(m));
        if (!overlap) {
          return {
            priorQuestionId: prior.questionId,
            priorQuestion: prior.question,
            priorAnswer,
            newAnswer,
            reason: `语义轴「${axis}」上的取值发生切换：之前「${priorMatches.join("、")}」，现在「${newMatches.join("、")}」。`,
          };
        }
      }
    }
  }
  return null;
}

// ============================================================================
// projectAnswersToFields: roll up QA into 4 step fields
// ============================================================================
export function projectAnswersToFields(qa: StepQAItem[]): {
  userInput: string;
  constraints: string;
  extensionSpace: string;
  memory: string;
} {
  const buckets = {
    userInput: [] as string[],
    constraints: [] as string[],
    extensionSpace: [] as string[],
    memory: [] as string[],
  };
  for (const q of qa) {
    const txt = [
      q.selectedOptions.join("、"),
      q.freeText.trim(),
    ]
      .filter(Boolean)
      .join("；");
    if (!txt) continue;
    buckets[q.targetField].push(`${q.question} → ${txt}`);
  }
  return {
    userInput: buckets.userInput.join("\n"),
    constraints: buckets.constraints.join("\n"),
    extensionSpace: buckets.extensionSpace.join("\n"),
    memory: buckets.memory.join("\n"),
  };
}

// ============================================================================
// Suggestions (history chips)
// ============================================================================
export function generateSuggestions(
  _project: HydratedProject,
  stepId: StepId,
): {
  userInput: string[];
  constraints: string[];
  extensionSpace: string[];
  memory: string[];
} {
  const bank = STEP_QUESTIONS[stepId];
  const out = {
    userInput: [] as string[],
    constraints: [] as string[],
    extensionSpace: [] as string[],
    memory: [] as string[],
  };
  for (const q of bank) {
    out[q.targetField].push(...q.options);
  }
  return out;
}

// ============================================================================
// generateStepContent — real-LLM first, fall back to deterministic template
// ============================================================================
export async function generateStepContent(
  project: HydratedProject,
  stepId: StepId,
): Promise<{ content: GeneratedContent; mode: "real" | "mock" }> {
  const real = await realStepGenerate(project, stepId);
  if (real) return { content: real, mode: "real" };
  return { content: mockAgentGenerate(project, stepId), mode: "mock" };
}

// ============================================================================
// mockAgentGenerate: deterministic per-step generation
// ============================================================================
export function mockAgentGenerate(
  project: HydratedProject,
  stepId: StepId,
): GeneratedContent {
  const step = project.steps[stepId];
  const meta = STEP_META[stepId];
  const boundary = project.globalMemory.productBoundary;
  const ideaSummary =
    project.globalMemory.ideaSummary || `${project.name}：${project.initialIdea}`;

  const fields = step.userInput || step.constraints || step.extensionSpace
    ? {
        userInput: step.userInput,
        constraints: step.constraints,
        extensionSpace: step.extensionSpace,
        memory: step.memory,
      }
    : projectAnswersToFields(step.qa);

  const priorReady = (Object.values(project.steps) as any[])
    .filter(
      (s: any) =>
        s.id !== stepId &&
        s.generatedContent &&
        ["generated", "saved", "locked"].includes(s.status),
    )
    .map((s: any) => `- ${STEP_META[s.id as StepId].name}：${s.generatedContent.summary}`)
    .join("\n");

  const summaryPrefix = `[${meta.name} · ${meta.subtitle}]`;
  const summary = `${summaryPrefix} ${ideaSummary} 在「${meta.name}」阶段的核心结论：${
    fields.userInput || "围绕真实问题与目标用户收敛。"
  }`;

  const keyQuestions = [
    `${meta.name}：核心目标用户是谁？`,
    `${meta.name}：48 小时内必须交付什么？`,
    `${meta.name}：哪些事情这一版不做？`,
  ];

  const analysis = [
    `## ${meta.name} · ${meta.subtitle}`,
    "",
    `**项目**：${project.name}`,
    `**一句话想法**：${project.initialIdea}`,
    "",
    boundary.confirmedAt
      ? `**Step 0 边界**：目标用户「${boundary.targetUser || "—"}」/ 输入输出「${boundary.ioShape || "—"}」/ 首版范围「${boundary.notDoing || "—"}」`
      : "**Step 0 边界**：尚未确认。",
    "",
    "**本步用户输入**",
    fields.userInput || "（暂无）",
    "",
    "**约束**",
    fields.constraints || "（暂无）",
    "",
    "**扩展空间**",
    fields.extensionSpace || "（暂无）",
    "",
    "**记忆**",
    fields.memory || "（暂无）",
    "",
    priorReady ? `**已 ready 的前置步骤**\n${priorReady}` : "",
    "",
    `**Builder Test 语境**：48 小时内必须给出可运行 Demo + 提交说明，所以这一步要把模糊想法压实成 ${meta.name} 的可执行结论。`,
  ].join("\n");

  const suggestedOutput = stepBoilerplate(stepId, project, fields);

  const risks = [
    "Mock 路径下结论偏模板化，真实 LLM 接入后需复核。",
    "如果 Step 0 边界没确认，结论可能偏离首版范围。",
  ];
  const decisions = [
    `保留 ${meta.name} 的核心结论作为后续步骤的输入。`,
    "用户手动改过的字段不会被下次生成覆盖。",
  ];
  const extensionSpace = [
    "下一轮可接入真实 LLM 强化论证。",
    "可在 Submission Brief 中引用本步骤结论。",
  ];

  return {
    summary,
    keyQuestions,
    analysis,
    suggestedOutput,
    risks,
    decisions,
    extensionSpace,
    nextStepHint: `下一步建议：进入「${nextStepName(stepId)}」继续收敛。`,
    userEdited: step.generatedContent?.userEdited || {},
    touchedFields: step.generatedContent?.touchedFields || [],
  };
}

function nextStepName(stepId: StepId): string {
  const order: StepId[] = [...(["discovery", "definition", "solution", "mvp", "build", "ship"] as StepId[])];
  const idx = order.indexOf(stepId);
  if (idx < 0 || idx === order.length - 1) return "最终输出";
  return STEP_META[order[idx + 1]].name;
}

function stepBoilerplate(
  stepId: StepId,
  project: HydratedProject,
  fields: { userInput: string; constraints: string; extensionSpace: string; memory: string },
): Record<string, any> {
  switch (stepId) {
    case "discovery":
      return {
        problem: fields.userInput || `用户在 ${project.initialIdea} 这件事上缺少结构化方法。`,
        targetUser: project.globalMemory.productBoundary.targetUser || "单人浏览器场景的产品小白",
        scenarios: [
          "周末在家收敛一个想法",
          "工作日午休前后的零碎时间",
          "Builder Test 截止前一晚",
        ],
        valueHypothesis: "AI 把模糊想法压成结构化字段，比空白文档快 3 倍。",
      };
    case "definition":
      return {
        problemStatement: `把「${project.initialIdea}」从想法变成 48 小时可交付的 Demo。`,
        inputs: ["一句话想法", "项目名", "Step 0 边界", "6 步问答"],
        outputs: ["PRD.md", "README.md", "Tasks.md", "submission-brief.md"],
        shortestPath: "创建项目 → Step 0 → 任一步生成 → 三卡输出 + Submission Brief",
      };
    case "solution":
      return {
        aiRole: "把模糊想法收敛成结构化字段，并诚实标注 Mock/Real 来源。",
        nonAiParts: ["Demo 链接的真实有效性", "锁定步骤的覆盖控制"],
        techShape: "Vite + React + Express + SQLite，Mock 默认可用。",
        modelStrategy: "v1 全 Mock；Round 13 接入 OpenAI-compatible（Perplexity/DeepSeek/OpenAI）。",
      };
    case "mvp":
      return {
        loop: "创建项目 → Step 0 边界 → 任一步问答 → 生成 → 三卡 + Submission Brief",
        cuts: ["登录", "多人协作", "复杂样式系统", "真实 LLM"],
        keepers: ["Mock 默认可用", "honest provenance", "Snapshot 导入导出"],
      };
    case "build":
      return {
        stack: "React 18 + Vite + Express 5 + better-sqlite3 + Tailwind + shadcn/ui",
        plan48h: [
          "Day 1 上午：schema + storage + CRUD",
          "Day 1 下午：6 步 Mock 生成 + 引导问答",
          "Day 2 上午：三卡输出 + Submission Brief",
          "Day 2 下午：Snapshot + Agent Mode + 部署",
        ],
        deliverables: ["可运行 Web App", "三份 Markdown + Submission Brief", "Snapshot JSON 导入导出"],
      };
    case "ship":
      return {
        demoChannel: "公开部署链接（pplx.app）+ 60 秒 Pitch",
        roadmap: ["接入真实 LLM", "增加 PDF 导出", "Submission Brief 多语言"],
        pitchSeed: `48 小时内，把「${project.initialIdea}」收敛成可演示的 Demo 套件。`,
      };
  }
}
