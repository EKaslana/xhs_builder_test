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
    `请基于以上信息，给出本步骤的下一个引导问题（中文）。硬性要求：\n` +
    `1. 必须是【单选】问题，三个选项必须是同一维度上的【互斥取值】（mutually exclusive on a single named dimension），用户只能选其中之一。\n` +
    `2. 选项不能是不同维度的并列特性（例如「登录、LLM、样式」三件无关的事不可作为同一题的三选项）。\n` +
    `3. 必须先在心里命名这个维度（例如：使用频率 / 付费意愿 / 内容长度 / 输出形态 / 失败成本），然后给出该维度上三个不能同时为真的取值。\n` +
    `4. 必须给出 dimensionLabel 字段（≤6 字），明示本题的维度名。\n` +
    `5. 不要重复已经问过的问题；选项尽量贴合 48 小时 Builder Test 的真实约束。\n` +
    `6. targetField 必须是以下之一：userInput / constraints / extensionSpace / memory。`;
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

// 每步 5 题：每题 3 个选项严格在同一维度上互斥（单选）
const STEP_QUESTIONS: Record<StepId, QBank> = {
  // ----------------------------------------------------------------
  // Step 1 · Discovery 需求发现
  // ----------------------------------------------------------------
  discovery: [
    {
      question: "目标用户遇到这个问题的【频率】是？",
      targetField: "userInput",
      options: [
        "每天都会遇到",
        "每周 1–2 次",
        "一个月不到一次",
      ],
      insights: {
        "每天都会遇到": "高频刚需，必上闭环。",
        "每周 1–2 次": "中频，优先级次于每日场景。",
        "一个月不到一次": "低频，在 48h Demo 中不优先服务。",
      },
      dimensionLabel: "遇到频率",
    },
    {
      question: "该问题在用户一次使用中【耗费的时间】是？",
      targetField: "userInput",
      options: [
        "少于 5 分钟",
        "5–30 分钟",
        "超过 30 分钟",
      ],
      insights: {
        "少于 5 分钟": "微场景，产品只能是轻量助手。",
        "5–30 分钟": "中量场景，适合 Builder Test 范例。",
        "超过 30 分钟": "重场景，必须提供明显压缩。",
      },
      dimensionLabel: "单次耗时",
    },
    {
      question: "用户【现在】是怎么解决这个问题的？",
      targetField: "constraints",
      options: [
        "什么都不做，硬扣",
        "用通用 LLM（ChatGPT/Kimi）凑",
        "手工 + Excel/笔记软件",
      ],
      insights: {
        "什么都不做，硬扣": "需求存在但代替品为零，机会最大。",
        "用通用 LLM（ChatGPT/Kimi）凑": "市场已验证 AI 可用，凑合场景贴合。",
        "手工 + Excel/笔记软件": "需求足以推动用户自建流程，付费意愿偶高。",
      },
      dimensionLabel: "现有方案",
    },
    {
      question: "用户为这个问题【付费的意愿】是？",
      targetField: "memory",
      options: [
        "完全不付费，只要免费",
        "愿意付小额订阅（≤9 元/月）",
        "肯付 30+/月 主动订阅",
      ],
      insights: {
        "完全不付费，只要免费": "只能吃广告/渠道红利。",
        "愿意付小额订阅（≤9 元/月）": "轻订阅场景，需调起高频使用习惯。",
        "肯付 30+/月 主动订阅": "专业场景，可以提高 LLM 调用成本。",
      },
      dimensionLabel: "付费意愿",
    },
    {
      question: "这个必须依靠 AI 才能解决的【不可替代性】多强？",
      targetField: "memory",
      options: [
        "必须靠 AI，手工完全做不动",
        "AI 能代替 50% 工作，其余人补充",
        "不靠 AI 也能，AI 只提效",
      ],
      insights: {
        "必须靠 AI，手工完全做不动": "产品价值隔离度高，可营销点明确。",
        "AI 能代替 50% 工作，其余人补充": "人机协作型，需设计交接点。",
        "不靠 AI 也能，AI 只提效": "价值薄，需重新考虑是否作为 Demo 主轴。",
      },
      dimensionLabel: "AI 依赖度",
    },
  ],
  // ----------------------------------------------------------------
  // Step 2 · Definition 问题定义
  // ----------------------------------------------------------------
  definition: [
    {
      question: "首版【输入】限定为？",
      targetField: "userInput",
      options: [
        "一句话自然语言",
        "结构化表单（多个字段）",
        "上传文件（如 PDF/图片）",
      ],
      insights: {
        "一句话自然语言": "门槛最低，但 LLM 负担重。",
        "结构化表单（多个字段）": "输入质量高，但跳出率升。",
        "上传文件（如 PDF/图片）": "48h 内实现多模态难度高。",
      },
      dimensionLabel: "输入形态",
    },
    {
      question: "首版【输出】设为？",
      targetField: "userInput",
      options: [
        "一段可复制的 Markdown",
        "可下载的 PDF/PPTX 文件",
        "可跳转的公开页面链接",
      ],
      insights: {
        "一段可复制的 Markdown": "最快实现，可直接贴到小红书。",
        "可下载的 PDF/PPTX 文件": "需增加模板与渲染成本。",
        "可跳转的公开页面链接": "需要后端会话与可分享 URL。",
      },
      dimensionLabel: "输出形态",
    },
    {
      question: "首版的【服务范围】限定为？",
      targetField: "constraints",
      options: [
        "只服务个人单机场景",
        "允许多项目但仅本人可见",
        "多人协作与权限分享",
      ],
      insights: {
        "只服务个人单机场景": "最小实现，不需登录。",
        "允许多项目但仅本人可见": "需本地身份但仍可跳过登录。",
        "多人协作与权限分享": "超过 48h 范围。",
      },
      dimensionLabel: "服务范围",
    },
    {
      question: "【成功指标】优先看哪个？",
      targetField: "memory",
      options: [
        "从输入到可提交输出 ≤ 5 分钟",
        "生成内容被用户保留超过 60%",
        "五星评价 ≥ 4.5",
      ],
      insights: {
        "从输入到可提交输出 ≤ 5 分钟": "速度为王，适合 Builder Test 场景。",
        "生成内容被用户保留超过 60%": "质量为王，需丰富评估手段。",
        "五星评价 ≥ 4.5": "主观指标，难以衡量，不推荐作首要。",
      },
      dimensionLabel: "核心指标",
    },
    {
      question: "【会话边界】项目间上下文怎么处理？",
      targetField: "constraints",
      options: [
        "项目之间完全隔离，不共享记忆",
        "仅在同一项目内共享上下文",
        "跨项目取平均记忆",
      ],
      insights: {
        "项目之间完全隔离，不共享记忆": "最可预测，适合 Demo 场景。",
        "仅在同一项目内共享上下文": "本产品默认选择。",
        "跨项目取平均记忆": "易间接泄漏，不推荐。",
      },
      dimensionLabel: "记忆边界",
    },
  ],
  // ----------------------------------------------------------------
  // Step 3 · Solution 方案设计
  // ----------------------------------------------------------------
  solution: [
    {
      question: "AI 在本方案中的【主要角色】是？",
      targetField: "userInput",
      options: [
        "收敛器：把模糊压成结构字段",
        "生成器：输出可复制的最终产物",
        "评审器：检查用户手工输入的质量",
      ],
      insights: {
        "收敛器：把模糊压成结构字段": "适合问答型产品。",
        "生成器：输出可复制的最终产物": "适合输出型产品。",
        "评审器：检查用户手工输入的质量": "适合检查型场景。",
      },
      dimensionLabel: "AI 角色",
    },
    {
      question: "【交互形态】选哪一种？",
      targetField: "userInput",
      options: [
        "多轮 Chat 对话",
        "分步向导（向导式表单）",
        "一次性表单提交",
      ],
      insights: {
        "多轮 Chat 对话": "自由度高，但可控性低。",
        "分步向导（向导式表单）": "本产品默认选择，可控性高。",
        "一次性表单提交": "门槛低，但 Demo 所产出内容质量受限。",
      },
      dimensionLabel: "交互形态",
    },
    {
      question: "【LLM 调用策略】？",
      targetField: "constraints",
      options: [
        "同步单次调用，等响应后一次出结果",
        "分步多次调用，逐次交付",
        "不调，全部走 Mock 模拟输出",
      ],
      insights: {
        "同步单次调用，等响应后一次出结果": "实现最简，响应时间长。",
        "分步多次调用，逐次交付": "体验好，但调用成本高。",
        "不调，全部走 Mock 模拟输出": "零成本冷启动，适合 Demo 兜底。",
      },
      dimensionLabel: "LLM 策略",
    },
    {
      question: "【失败处理】：LLM 超时/报错时怎么办？",
      targetField: "constraints",
      options: [
        "直接报错给用户，要求重试",
        "自动回退到 Mock 默认输出",
        "隔离问题，允许用户手动填写",
      ],
      insights: {
        "直接报错给用户，要求重试": "用户感受差，不推荐 Demo。",
        "自动回退到 Mock 默认输出": "本产品默认策略，需 banner 告知 provenance。",
        "隔离问题，允许用户手动填写": "选型，但中断了流程。",
      },
      dimensionLabel: "失败处理",
    },
    {
      question: "【不交给 AI 的类别】是？",
      targetField: "extensionSpace",
      options: [
        "亲手决策（如是否提交 Builder Test）",
        "外部动作（如发邮件、购买）",
        "锁定后的覆盖修改",
      ],
      insights: {
        "亲手决策（如是否提交 Builder Test）": "AI 不替用户拍板。",
        "外部动作（如发邮件、购买）": "避免不可逆副作用。",
        "锁定后的覆盖修改": "保护用户已确认的产出。",
      },
      dimensionLabel: "AI 禁区",
    },
  ],
  // ----------------------------------------------------------------
  // Step 4 · MVP 最小 Demo
  // ----------------------------------------------------------------
  mvp: [
    {
      question: "【MVP 路径长度】是？",
      targetField: "userInput",
      options: [
        "几个屏完成（1–3 屏）",
        "中等路径（4–6 屏）",
        "完整多步闭环（7+ 屏）",
      ],
      insights: {
        "几个屏完成（1–3 屏）": "适合 Pitch 展示。",
        "中等路径（4–6 屏）": "本产品默认选择。",
        "完整多步闭环（7+ 屏）": "超出 48h 范围。",
      },
      dimensionLabel: "路径长度",
    },
    {
      question: "【数据持久化】选？",
      targetField: "constraints",
      options: [
        "不持久，刷新即清",
        "SQLite 本地文件（本规格）",
        "远端数据库（Postgres/Mongo）",
      ],
      insights: {
        "不持久，刷新即清": "Demo 足够，但丢失 Snapshot 能力。",
        "SQLite 本地文件（本规格）": "本产品默认选择，依靠 Render 磁盘。",
        "远端数据库（Postgres/Mongo）": "超出 48h，不推荐 Demo。",
      },
      dimensionLabel: "持久化",
    },
    {
      question: "【身份认证】怎么处理？",
      targetField: "constraints",
      options: [
        "不要登录，全本地隐式身份",
        "轻量 magic-link（邮箱）",
        "完整 OAuth + 多身份提供商",
      ],
      insights: {
        "不要登录，全本地隐式身份": "实现最快，本产品默认。",
        "轻量 magic-link（邮箱）": "增加邮件服务依赖。",
        "完整 OAuth + 多身份提供商": "超出 48h，不推荐。",
      },
      dimensionLabel: "登录方式",
    },
    {
      question: "【如果只能保一个亮点】你保？",
      targetField: "userInput",
      options: [
        "输出质量（生成内容高度充实、可复制）",
        "路径顺畅（闭环不中断，倒计时三分钟出 Demo）",
        "视觉精美（动画/主题/可分享页面样式）",
      ],
      insights: {
        "输出质量（生成内容高度充实、可复制）": "AI 产品核心价值。",
        "路径顺畅（闭环不中断，倒计时三分钟出 Demo）": "Pitch 现场友好。",
        "视觉精美（动画/主题/可分享页面样式）": "适合社交分享，但 48h 难于同时兼顾。",
      },
      dimensionLabel: "唯一亮点",
    },
    {
      question: "【失败动作】首版不提供？",
      targetField: "extensionSpace",
      options: [
        "多人协作/实时同步",
        "多语言友好界面",
        "多模态输入（语音/图片）",
      ],
      insights: {
        "多人协作/实时同步": "需 WebSocket，不适 48h。",
        "多语言友好界面": "可作为 v2 扩展点。",
        "多模态输入（语音/图片）": "需额外调用与详解成本。",
      },
      dimensionLabel: "首版不做",
    },
  ],
  // ----------------------------------------------------------------
  // Step 5 · Build 实现路径
  // ----------------------------------------------------------------
  build: [
    {
      question: "【后端架构】选？",
      targetField: "userInput",
      options: [
        "Express 单进程（本规格）",
        "Next.js API Routes",
        "无后端（纯静态 + 外部 LLM）",
      ],
      insights: {
        "Express 单进程（本规格）": "符合 v2 规格。",
        "Next.js API Routes": "一体化但部署复杂。",
        "无后端（纯静态 + 外部 LLM）": "成本低，但丢失持久化。",
      },
      dimensionLabel: "后端架构",
    },
    {
      question: "【部署平台】首选？",
      targetField: "userInput",
      options: [
        "Render（本产品默认）",
        "Vercel",
        "自建 VPS / 云主机",
      ],
      insights: {
        "Render（本产品默认）": "支持 Persistent Disk + Node 后端。",
        "Vercel": "Serverless，SQLite 不可用。",
        "自建 VPS / 云主机": "运维成本高，不适 48h。",
      },
      dimensionLabel: "部署平台",
    },
    {
      question: "【时间分配】两天怎么切？",
      targetField: "constraints",
      options: [
        "Day1 后端 + schema，Day2 前端 + 输出",
        "Day1 端到端 Mock 跑通，Day2 打磨",
        "Day1 UI 骨架，Day2 后端 + LLM",
      ],
      insights: {
        "Day1 后端 + schema，Day2 前端 + 输出": "稳健路径。",
        "Day1 端到端 Mock 跑通，Day2 打磨": "保 Demo 优先，本产品选择。",
        "Day1 UI 骨架，Day2 后端 + LLM": "面子工程风险高。",
      },
      dimensionLabel: "时间分配",
    },
    {
      question: "【模型选型】优先接哪家 LLM？",
      targetField: "userInput",
      options: [
        "Perplexity sonar",
        "DeepSeek Chat",
        "OpenAI GPT-4o-mini",
      ],
      insights: {
        "Perplexity sonar": "自带 web 检索，适合需调研的 Demo。",
        "DeepSeek Chat": "价格最低，适合高频调用。",
        "OpenAI GPT-4o-mini": "社区生态成熟，但需使用代理访问。",
      },
      dimensionLabel: "LLM 供应商",
    },
    {
      question: "【调试策略】什么优先？",
      targetField: "constraints",
      options: [
        "本地 npm run dev 热重载",
        "推到 staging 环境验证",
        "直接推生产环境",
      ],
      insights: {
        "本地 npm run dev 热重载": "本产品默认选择。",
        "推到 staging 环境验证": "质量安全，但 48h 内耗费时间。",
        "直接推生产环境": "风险最高，不推荐。",
      },
      dimensionLabel: "调试策略",
    },
  ],
  // ----------------------------------------------------------------
  // Step 6 · Ship 展示迭代
  // ----------------------------------------------------------------
  ship: [
    {
      question: "【展示形式】提交时优先？",
      targetField: "userInput",
      options: [
        "公开部署链接 + 60 秒 Pitch",
        "录屏视频 + Submission Brief",
        "本地启动 + Snapshot JSON 演示",
      ],
      insights: {
        "公开部署链接 + 60 秒 Pitch": "本产品默认，最适合小红书提交。",
        "录屏视频 + Submission Brief": "稳健的兜底方式。",
        "本地启动 + Snapshot JSON 演示": "现场互动，但不可复现。",
      },
      dimensionLabel: "展示形式",
    },
    {
      question: "【Pitch 时长】设为？",
      targetField: "constraints",
      options: [
        "30 秒闪电型",
        "60 秒标准型",
        "3 分钟详解型",
      ],
      insights: {
        "30 秒闪电型": "适合社交如微信环境。",
        "60 秒标准型": "本产品默认，适合小红书。",
        "3 分钟详解型": "适合路演、面试，社交场景过长。",
      },
      dimensionLabel: "Pitch 时长",
    },
    {
      question: "【反馈采集】主道是？",
      targetField: "userInput",
      options: [
        "表单/问卷（主动填写）",
        "产品内埋点（被动采集）",
        "手动 1-on-1 访谈",
      ],
      insights: {
        "表单/问卷（主动填写）": "门槛低，但质量不高。",
        "产品内埋点（被动采集）": "本产品默认选择。",
        "手动 1-on-1 访谈": "深度高，但量小。",
      },
      dimensionLabel: "反馈采集",
    },
    {
      question: "【下一轮优先点】是？",
      targetField: "extensionSpace",
      options: [
        "接入真实 LLM（Perplexity/DeepSeek/OpenAI）",
        "增加导出格式（PDF / 飞书）",
        "Submission Brief 多语言版本",
      ],
      insights: {
        "接入真实 LLM（Perplexity/DeepSeek/OpenAI）": "Round 13 计划，提升内容质量。",
        "增加导出格式（PDF / 飞书）": "扩展交付能力。",
        "Submission Brief 多语言版本": "面向海外提交场景。",
      },
      dimensionLabel: "下轮重点",
    },
    {
      question: "【问题优先级】上线后发现 bug 如何处理？",
      targetField: "constraints",
      options: [
        "必须全部修复后再提交",
        "P0 必修，其余进迭代",
        "提交为先，后续热修复",
      ],
      insights: {
        "必须全部修复后再提交": "耗费 Builder Test 时间，风险高。",
        "P0 必修，其余进迭代": "本产品默认选择。",
        "提交为先，后续热修复": "Demo 优先，但以口碑为代价。",
      },
      dimensionLabel: "修复优先级",
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
