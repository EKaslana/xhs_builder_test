/**
 * 演示项目种子（Demo Seed）
 *
 * 目的：每次部署后，让首页都有一个完整、可点开的示例项目，避免空白页。
 * 主题：「小红书 3+1 选题 Agent」—— 帮内容创作者每天 5 分钟搞定选题、
 *        角度、标题、首段，避免空泛和重复。
 *
 * 启动时调用 `seedDemoProject()`：
 *   - 如果数据库里已经有 ID = DEMO_PROJECT_ID 的项目，跳过；
 *   - 否则插入一份完整的 6 步内容（含 chip 问答 + generatedContent + 最终 PRD）。
 *
 * 用户可以在演示项目里自由编辑、删除；删除后下次重启会自动重建。
 */

import {
  STEP_IDS,
  STEP_META,
  type HydratedProject,
  type StepState,
  type StepId,
  type GeneratedContent,
  type StepQAItem,
} from "@shared/schema";
import { storage } from "./storage";

export const DEMO_PROJECT_ID = "demo-xhs-agent";
const DEMO_NAME = "小红书 3+1 选题 Agent";
const DEMO_INITIAL_IDEA =
  "做一个帮小红书内容创作者每天 5 分钟搞定选题、角度、标题、首段的 AI 教练，告别空泛和重复。";

const NOW_BASELINE = 1746659400000; // 2025-05-08 13:10 CST，固定值保证可复现

function qa(
  step: string,
  idx: number,
  question: string,
  targetField: StepQAItem["targetField"],
  options: string[],
  selected: string[],
  freeText = "",
): StepQAItem {
  return {
    questionId: `${step}-q${idx}`,
    question,
    targetField,
    options,
    selectedOptions: selected,
    freeText,
    createdAt: NOW_BASELINE + idx * 1000,
  };
}

// ------------------------------------------------------------
// Step 1 · Discovery 需求发现
// ------------------------------------------------------------
const discoveryQA: StepQAItem[] = [
  qa(
    "discovery",
    1,
    "目标用户每天最痛的一件事是什么？",
    "userInput",
    [
      "想不出新选题，每天 30 分钟在刷竞品",
      "标题写不爆，发出去阅读量平平",
      "正文模板化严重，自己都看腻了",
    ],
    [
      "想不出新选题，每天 30 分钟在刷竞品",
      "正文模板化严重，自己都看腻了",
    ],
    "尤其是腰部博主（粉丝 1k-5w），创作时间最被选题阶段吞掉。",
  ),
  qa(
    "discovery",
    2,
    "他们现在用什么方式解决？",
    "constraints",
    [
      "刷小红书首页 + 同行账号找灵感",
      "用 ChatGPT / Kimi 凑选题（但内容空泛）",
      "靠 Excel 维护选题库",
    ],
    [
      "刷小红书首页 + 同行账号找灵感",
      "用 ChatGPT / Kimi 凑选题（但内容空泛）",
    ],
    "通用 LLM 给出的选题太空，缺少小红书语境（emoji、口语、对标账号）。",
  ),
  qa(
    "discovery",
    3,
    "AI 在这个环节真的有不可替代的价值吗？",
    "memory",
    [
      "是 —— AI 能整合站内热词、对标爆款、用户人设，做高密度组合",
      "是 —— AI 能把空泛选题落到具体场景，减少 80% 试错",
      "未必 —— 资深博主自己更懂",
    ],
    [
      "是 —— AI 能整合站内热词、对标爆款、用户人设，做高密度组合",
      "是 —— AI 能把空泛选题落到具体场景，减少 80% 试错",
    ],
  ),
];

const discoveryGen: GeneratedContent = {
  summary:
    "小红书腰部内容创作者（1k-5w 粉）每天有 30+ 分钟卡在「选题 + 角度」阶段，通用 LLM 输出空泛、不符合小红书语境，需要一个懂平台、懂人设、懂爆款规律的 AI 选题教练。",
  keyQuestions: [
    "目标用户每天最痛的一件事是什么？",
    "他们现在用什么方式解决？",
    "AI 在这个环节真的有不可替代的价值吗？",
  ],
  analysis:
    "三大真实痛点：① 选题空泛——通用 LLM 不懂「拍立得 / 多巴胺 / city walk」这类站内热词；② 角度雷同——博主自己也会陷入个人模板；③ 标题不爆——缺少对小红书首图 + 标题点击规律的判断。AI 在这个场景下有清晰的三层价值：知识压缩（站内热词库）+ 风格迁移（人设 → 选题）+ 爆款解构（对标拆元素）。",
  suggestedOutput: {
    targetUser: "小红书腰部博主（1k-5w 粉），垂类不限",
    coreProblem: "每天 30 分钟卡在选题/角度，输出同质化",
    aiValue: "把通用想法 → 平台具体场景的高密度选题组合",
  },
  risks: [
    "通用 LLM 越来越强，护城河在「站内语境 + 人设记忆」",
    "热词时效性短，需要每周更新",
  ],
  decisions: [
    "锁定腰部博主，不做素人和头部",
    "AI 输出必须带「为什么这个选题适合你的人设」的解释",
  ],
  extensionSpace: [
    "未来可拓展到 抖音 / 即刻 / 公众号",
    "可作为 MCN 内部选题工具",
  ],
  nextStepHint: "下一步把这个痛点收敛成一个具体的、可量化的产品问题。",
  userEdited: {},
  touchedFields: [],
};

// ------------------------------------------------------------
// Step 2 · Definition 问题定义
// ------------------------------------------------------------
const definitionQA: StepQAItem[] = [
  qa(
    "definition",
    1,
    "用户输入是什么？",
    "userInput",
    [
      "一句话方向（如「美食探店」「职场穿搭」）",
      "人设标签（垂类、风格、过往爆款）",
      "本周想突破的指标（涨粉/互动/收藏）",
    ],
    [
      "一句话方向（如「美食探店」「职场穿搭」）",
      "人设标签（垂类、风格、过往爆款）",
    ],
  ),
  qa(
    "definition",
    2,
    "用户期望的输出是什么？",
    "constraints",
    [
      "3 个差异化选题 + 1 个反向思考选题",
      "每个选题配标题 + 首段 + 标签",
      "对标账号清单（3 个）",
    ],
    [
      "3 个差异化选题 + 1 个反向思考选题",
      "每个选题配标题 + 首段 + 标签",
    ],
    "「3+1」是核心结构：3 个常规角度 + 1 个反向角度，让用户既稳又有惊喜。",
  ),
  qa(
    "definition",
    3,
    "成功标准（用户什么时候会说「真有用」）？",
    "memory",
    [
      "5 分钟内能用 1 个选题开写",
      "选题命中率（用户愿意发布）≥ 60%",
      "比通用 LLM 给的选题更具体、更可执行",
    ],
    [
      "5 分钟内能用 1 个选题开写",
      "选题命中率（用户愿意发布）≥ 60%",
    ],
  ),
];

const definitionGen: GeneratedContent = {
  summary:
    "输入：一句话垂类方向 + 人设标签。输出：3 个差异化选题 + 1 个反向选题，每个选题配「标题 + 首段 + 标签 + 对标账号」。成功标准：用户 5 分钟内能直接开写，命中率 ≥ 60%。",
  keyQuestions: [
    "用户输入是什么？",
    "用户期望的输出是什么？",
    "成功标准（用户什么时候会说「真有用」）？",
  ],
  analysis:
    "把模糊的「我想要选题」变成 4 项明确产物：标题、首段、标签、对标账号。3+1 结构是关键设计——3 个常规给安全感，1 个反向给惊喜。这种结构既能日常稳定使用，又能偶尔跳出舒适区，匹配博主真实的内容节奏。",
  suggestedOutput: {
    inputContract: "垂类方向（≤30字） + 人设标签（≤5个）",
    outputContract:
      "3 个常规选题 + 1 个反向选题，每个 = {标题, 首段开头 80 字, 推荐标签 3-5 个, 对标账号}",
    successMetric: "5 分钟生成 + 60% 命中率",
  },
  risks: [
    "首段开头如果太雷同，用户会失去新鲜感",
    "反向选题如果太离谱反而劝退",
  ],
  decisions: [
    "采用 3+1 结构，不做 5 也不做 1",
    "首段开头限制 80 字，避免「废话开头」",
  ],
  extensionSpace: [
    "对标账号可拓展为「学习他/她什么具体技巧」",
    "可加「本周热词」彩蛋字段",
  ],
  nextStepHint: "下一步设计具体的 AI 方案：怎么生成、用什么数据、AI 与人写各做什么。",
  userEdited: {},
  touchedFields: [],
};

// ------------------------------------------------------------
// Step 3 · Solution 方案设计
// ------------------------------------------------------------
const solutionQA: StepQAItem[] = [
  qa(
    "solution",
    1,
    "AI 这一侧负责什么？",
    "userInput",
    [
      "整合站内热词 + 用户人设，组合出选题",
      "生成标题（紧凑、带钩子、20 字内）",
      "拆解对标爆款的结构，迁移到用户人设",
    ],
    [
      "整合站内热词 + 用户人设，组合出选题",
      "生成标题（紧凑、带钩子、20 字内）",
      "拆解对标爆款的结构，迁移到用户人设",
    ],
  ),
  qa(
    "solution",
    2,
    "非 AI 部分（确定性逻辑）做什么？",
    "constraints",
    [
      "热词库 / 对标账号库的检索",
      "标签按平台规则规范化（≤10 个，去重，限长）",
      "敏感词过滤、长度截断",
    ],
    [
      "热词库 / 对标账号库的检索",
      "标签按平台规则规范化（≤10 个，去重，限长）",
      "敏感词过滤、长度截断",
    ],
    "非 AI 部分保证可控、可复现；AI 只做创意组合。",
  ),
  qa(
    "solution",
    3,
    "用户最终怎么消费输出？",
    "extensionSpace",
    [
      "3+1 卡片，每张卡片可一键复制到剪贴板",
      "支持「再来一组」重新生成",
      "支持「锁定这个选题」并继续生成下一篇配图脚本",
    ],
    [
      "3+1 卡片，每张卡片可一键复制到剪贴板",
      "支持「再来一组」重新生成",
    ],
  ),
];

const solutionGen: GeneratedContent = {
  summary:
    "三层架构：① 输入层（人设 + 方向）→ ② 检索层（热词库 + 对标爆款，非 AI）→ ③ 生成层（LLM 组合 + 标题打磨）。AI 只做创意组合，确定性的检索、规范化、过滤都用代码完成。输出为 4 张可一键复制的卡片。",
  keyQuestions: [
    "AI 这一侧负责什么？",
    "非 AI 部分（确定性逻辑）做什么？",
    "用户最终怎么消费输出？",
  ],
  analysis:
    "AI 与非 AI 边界清晰：AI 负责「人设 × 热词 × 爆款结构」三维组合 + 标题创意 + 首段口吻；非 AI 负责检索、规范化、过滤、长度控制。这种切分让结果稳定（80% 流程是确定的）+ 有惊喜（20% 由 LLM 创意）。",
  suggestedOutput: {
    aiResponsibilities: ["选题组合", "标题创意", "首段口吻迁移"],
    nonAiResponsibilities: ["热词检索", "标签规范化", "敏感词过滤"],
    consumeUx: "3+1 卡片 + 一键复制 + 再来一组 + 锁定深挖",
  },
  risks: [
    "热词库滞后会让选题显得过时",
    "标题太「钩子化」可能反感",
  ],
  decisions: [
    "AI 与非 AI 严格切分，便于后续替换 LLM 不影响业务",
    "首段开头不超过 80 字，由代码截断兜底",
  ],
  extensionSpace: [
    "热词库可接入第三方数据源（蝉妈妈 / 千瓜）",
    "对标账号库可让用户自己维护",
  ],
  nextStepHint: "下一步定义最小可演示版本：第一版只做哪部分？",
  userEdited: {},
  touchedFields: [],
};

// ------------------------------------------------------------
// Step 4 · MVP 最小 Demo
// ------------------------------------------------------------
const mvpQA: StepQAItem[] = [
  qa(
    "mvp",
    1,
    "Demo 演示时只演一条最关键路径，是哪条？",
    "userInput",
    [
      "输入「美食探店 + 我是上海宝藏餐厅打卡博主」→ 输出 3+1 选题卡片",
      "输入 + 选一张卡片 → 生成首段 + 标签",
      "输入 + 反复「再来一组」体验多样性",
    ],
    [
      "输入「美食探店 + 我是上海宝藏餐厅打卡博主」→ 输出 3+1 选题卡片",
    ],
    "演示时观众的注意力只够看一条主路径。",
  ),
  qa(
    "mvp",
    2,
    "第一版砍掉哪些功能？",
    "constraints",
    [
      "砍掉「锁定深挖」（留到 V2）",
      "砍掉「热词库实时更新」（写死本周 30 个热词）",
      "砍掉「对标账号自定义」（内置 20 个）",
    ],
    [
      "砍掉「锁定深挖」（留到 V2）",
      "砍掉「热词库实时更新」（写死本周 30 个热词）",
      "砍掉「对标账号自定义」（内置 20 个）",
    ],
  ),
  qa(
    "mvp",
    3,
    "Demo 完成的判定标准？",
    "memory",
    [
      "陌生人能在 3 分钟内独立跑通一次完整流程",
      "输出的 4 个选题里至少 2 个让博主想用",
      "标题 + 首段连续 5 次生成不重复",
    ],
    [
      "陌生人能在 3 分钟内独立跑通一次完整流程",
      "输出的 4 个选题里至少 2 个让博主想用",
    ],
  ),
];

const mvpGen: GeneratedContent = {
  summary:
    "V1 只做一条主路径：输入垂类 + 人设 → 输出 3+1 选题卡片。砍掉锁定深挖、热词实时更新、对标账号自定义。判定标准：陌生人 3 分钟独立跑通 + 4 个选题里至少 2 个让博主想用。",
  keyQuestions: [
    "Demo 演示时只演一条最关键路径，是哪条？",
    "第一版砍掉哪些功能？",
    "Demo 完成的判定标准？",
  ],
  analysis:
    "MVP 的关键不是少做，而是「敢砍」。锁定深挖、热词实时、自定义账号——任意一个都能让 Demo 翻倍，但都不影响主路径价值证明。把它们都砍到 V2，第一版就只剩「输入 → 输出」一条线，48 小时内必能跑通。",
  suggestedOutput: {
    keyPath: "输入 → 3+1 卡片",
    cutFromV1: ["锁定深挖", "热词实时更新", "对标账号自定义"],
    doneCriteria: "3 分钟独立跑通 + 4 选题至少 2 个被采纳",
  },
  risks: [
    "热词写死会被「过时」吐槽——首页诚实标注「本周热词截止 X 月 X 日」",
    "演示时陌生人若卡在输入栏，说明输入提示需要更具体",
  ],
  decisions: [
    "V1 输入只接收两个字段：垂类 + 人设",
    "热词库写死 30 条，每周一手动更新",
  ],
  extensionSpace: [
    "V1.5 加「锁定 + 生成首段」",
    "V2 加「对标账号自定义」",
  ],
  nextStepHint: "下一步给小白可执行的实现路径：用什么技术栈、48 小时怎么排时间。",
  userEdited: {},
  touchedFields: [],
};

// ------------------------------------------------------------
// Step 5 · Build 实现路径
// ------------------------------------------------------------
const buildQA: StepQAItem[] = [
  qa(
    "build",
    1,
    "选什么技术栈（小白也能跟上）？",
    "userInput",
    [
      "前端：Next.js + Tailwind（部署到 Vercel）",
      "后端：单文件 API Route（直接调 LLM）",
      "数据：JSON 文件存热词库 + 对标账号",
    ],
    [
      "前端：Next.js + Tailwind（部署到 Vercel）",
      "后端：单文件 API Route（直接调 LLM）",
      "数据：JSON 文件存热词库 + 对标账号",
    ],
  ),
  qa(
    "build",
    2,
    "48 小时如何分配？",
    "constraints",
    [
      "Day 1 上午：前端骨架 + 输入表单",
      "Day 1 下午：LLM Prompt 调优 + 后端串通",
      "Day 2 上午：UI 打磨 + 错误处理",
      "Day 2 下午：录视频 + 部署 + 提交",
    ],
    [
      "Day 1 上午：前端骨架 + 输入表单",
      "Day 1 下午：LLM Prompt 调优 + 后端串通",
      "Day 2 上午：UI 打磨 + 错误处理",
      "Day 2 下午：录视频 + 部署 + 提交",
    ],
  ),
  qa(
    "build",
    3,
    "Prompt 怎么写最关键？",
    "memory",
    [
      "强结构化：要求输出 JSON，4 个 item 各有 5 个字段",
      "强人设：把用户人设写进 system prompt，AI 全程「扮演 TA」",
      "Few-shot：给 1 条爆款示例，让 AI 学风格",
    ],
    [
      "强结构化：要求输出 JSON，4 个 item 各有 5 个字段",
      "强人设：把用户人设写进 system prompt，AI 全程「扮演 TA」",
      "Few-shot：给 1 条爆款示例，让 AI 学风格",
    ],
  ),
];

const buildGen: GeneratedContent = {
  summary:
    "技术栈：Next.js + Tailwind + Vercel + JSON 文件数据 + DeepSeek/Perplexity LLM。48 小时分四段：D1 上午前端骨架，D1 下午 Prompt + 串通，D2 上午 UI 打磨，D2 下午录视频 + 部署。Prompt 三要点：强结构化 JSON、强人设、Few-shot 一条示例。",
  keyQuestions: [
    "选什么技术栈（小白也能跟上）？",
    "48 小时如何分配？",
    "Prompt 怎么写最关键？",
  ],
  analysis:
    "技术栈选择遵循「最少新技术」原则——Next.js 一把梭，前后端同仓库，部署 Vercel 一键完成。Prompt 是真正的核心，三个手段缺一不可：JSON 结构化保证渲染稳定、人设 system prompt 保证个性化、few-shot 保证文案风格。",
  suggestedOutput: {
    stack: ["Next.js 15", "Tailwind", "Vercel", "DeepSeek API"],
    timeline: {
      "D1 AM": "前端骨架 + 输入表单",
      "D1 PM": "Prompt 调优 + 后端串通",
      "D2 AM": "UI 打磨 + 错误处理",
      "D2 PM": "录视频 + 部署 + 提交",
    },
    promptKeys: ["JSON 结构", "人设注入", "1 条 few-shot"],
  },
  risks: [
    "LLM 偶尔返回非合法 JSON——需要 try/catch + 重试",
    "Vercel 免费层有冷启动——首次访问慢一两秒",
  ],
  decisions: [
    "API Key 走 Vercel 环境变量，不进仓库",
    "热词 JSON 直接 import，不走运行时读文件",
  ],
  extensionSpace: [
    "后续可换成 LangChain 做更复杂编排",
    "可加 Vercel KV 存用户历史",
  ],
  nextStepHint: "下一步规划怎么展示、怎么投递、第一版上线后怎么迭代。",
  userEdited: {},
  touchedFields: [],
};

// ------------------------------------------------------------
// Step 6 · Ship 展示迭代
// ------------------------------------------------------------
const shipQA: StepQAItem[] = [
  qa(
    "ship",
    1,
    "Demo 怎么展示最有冲击力？",
    "userInput",
    [
      "录 60 秒竖屏视频：输入 → 等待 3s → 4 张卡片飞出",
      "首页放 3 个真实博主 before/after 对比",
      "支持观众直接在线试用，无需登录",
    ],
    [
      "录 60 秒竖屏视频：输入 → 等待 3s → 4 张卡片飞出",
      "支持观众直接在线试用，无需登录",
    ],
  ),
  qa(
    "ship",
    2,
    "投递小红书 Builder Test 的关键素材？",
    "constraints",
    [
      "1 段 60s 视频（demo 全流程）",
      "1 段 30s 自我介绍（为什么我做这个）",
      "1 个公网可访问的 URL",
      "1 份 README（含技术栈、prompt、热词来源）",
    ],
    [
      "1 段 60s 视频（demo 全流程）",
      "1 个公网可访问的 URL",
      "1 份 README（含技术栈、prompt、热词来源）",
    ],
  ),
  qa(
    "ship",
    3,
    "上线后第一周做什么迭代？",
    "memory",
    [
      "找 5 个真实博主试用，收集卡顿点",
      "把「锁定深挖」从 V2 提到 V1.1",
      "热词库改成自动抓取（每周日定时任务）",
    ],
    [
      "找 5 个真实博主试用，收集卡顿点",
      "把「锁定深挖」从 V2 提到 V1.1",
    ],
  ),
];

const shipGen: GeneratedContent = {
  summary:
    "展示三件套：60s 竖屏 demo 视频 + 公网 URL（无需登录）+ 完整 README。投递素材清晰可复用。第一周迭代重点：5 个博主真实试用 → 把锁定深挖提到 V1.1。",
  keyQuestions: [
    "Demo 怎么展示最有冲击力？",
    "投递小红书 Builder Test 的关键素材？",
    "上线后第一周做什么迭代？",
  ],
  analysis:
    "展示阶段最关键的是「降低观众心理门槛」。视频要竖屏（小红书原生格式）+ 60 秒（注意力上限）+ 显示真实输入输出，让观众一看就懂；URL 不需要登录，让评委 30 秒内能上手玩一次。第一周迭代不要急着加新功能，先收 5 个真实博主反馈，决定 V1.1 砍什么补什么。",
  suggestedOutput: {
    demoAssets: ["60s 竖屏视频", "公网 URL（免登录）", "README"],
    submissionPackage: "视频 + URL + README + 30s 自我介绍",
    week1Roadmap: ["5 博主访谈", "锁定深挖提到 V1.1", "卡顿点修复"],
  },
  risks: [
    "评委可能在手机上打开——必须做好移动端适配",
    "首次访问冷启动慢——首页加 loading 动效兜底",
  ],
  decisions: [
    "视频用真实人设录，不用占位「张三李四」",
    "README 顶部就给 Live URL，不让评委翻",
  ],
  extensionSpace: [
    "可投递到「即刻 / 阮一峰周刊 / Geekpark」做二次分发",
    "可在小红书账号自己发一篇「我做了一个帮你选题的 AI」",
  ],
  nextStepHint: "项目已成形——回到首页可以下载 PRD/README/Tasks 三件套提交。",
  userEdited: {},
  touchedFields: [],
};

// ------------------------------------------------------------
// 组装完整项目
// ------------------------------------------------------------
const STEP_DATA: Record<
  StepId,
  { qa: StepQAItem[]; gen: GeneratedContent; userInput: string }
> = {
  discovery: {
    qa: discoveryQA,
    gen: discoveryGen,
    userInput:
      "腰部博主每天 30 分钟卡在选题阶段，通用 LLM 输出空泛、不懂小红书语境。",
  },
  definition: {
    qa: definitionQA,
    gen: definitionGen,
    userInput:
      "输入：垂类方向 + 人设标签。输出：3+1 选题，每个含标题/首段/标签/对标。",
  },
  solution: {
    qa: solutionQA,
    gen: solutionGen,
    userInput:
      "AI 做创意组合，非 AI 做检索/规范化/过滤。输出 3+1 卡片可一键复制。",
  },
  mvp: {
    qa: mvpQA,
    gen: mvpGen,
    userInput:
      "V1 只做主路径：输入 → 3+1 卡片。砍锁定深挖、热词实时、对标自定义。",
  },
  build: {
    qa: buildQA,
    gen: buildGen,
    userInput:
      "Next.js + Vercel + DeepSeek。48h 分四段。Prompt 三要点：JSON/人设/few-shot。",
  },
  ship: {
    qa: shipQA,
    gen: shipGen,
    userInput:
      "60s 视频 + 公网 URL + README。第一周找 5 博主收反馈再迭代。",
  },
};

function buildStep(id: StepId): StepState {
  const data = STEP_DATA[id];
  return {
    id,
    name: STEP_META[id].name,
    status: "saved",
    locked: false,
    userInput: data.userInput,
    constraints: "",
    extensionSpace: "",
    memory: "",
    qa: data.qa,
    qaComplete: true,
    generatedContent: data.gen,
    updatedAt: NOW_BASELINE,
  };
}

const FINAL_PRD = `# 小红书 3+1 选题 Agent · PRD

## 一句话
帮小红书腰部博主（1k-5w 粉）每天 5 分钟搞定选题、角度、标题、首段，告别空泛和重复。

## 用户与痛点
- 腰部博主每天 30+ 分钟卡在选题阶段
- 通用 LLM 输出空泛，不懂小红书站内语境（热词、人设、爆款结构）
- 自己写容易陷入个人模板

## 输入 / 输出契约
- **输入**：垂类方向（≤30 字）+ 人设标签（≤5 个）
- **输出**：3 个常规选题 + 1 个反向选题，每个 = { 标题(≤20字), 首段(≤80字), 标签(3-5个), 对标账号(1个) }

## AI / 非 AI 边界
- AI：选题组合、标题创意、首段口吻
- 非 AI：热词库检索、标签规范化、敏感词过滤、长度截断

## V1 范围
保留：主路径输入 → 3+1 卡片 + 一键复制 + 再来一组
砍掉：锁定深挖（V1.1）、热词实时更新（V2）、对标账号自定义（V2）

## 成功标准
- 陌生人 3 分钟内独立跑通完整流程
- 4 个选题里至少 2 个让博主想用（命中率 ≥ 60%）
- 5 次连续生成标题/首段不重复

## 风险与缓解
- 热词时效性：首页诚实标注「本周热词截止 X 月 X 日」
- LLM 返回非法 JSON：try/catch + 一次重试
- 标题太「钩子化」反感：在 Prompt 里加「自然口语，避免感叹号叠用」
`;

// ------------------------------------------------------------
// Seed entry
// ------------------------------------------------------------
export async function seedDemoProject(): Promise<void> {
  try {
    const existing = await storage.getProject(DEMO_PROJECT_ID);
    if (existing) {
      console.log(`[seed] demo project already exists (${DEMO_PROJECT_ID}), skip.`);
      return;
    }

    const steps = {} as HydratedProject["steps"];
    for (const id of STEP_IDS) {
      steps[id] = buildStep(id);
    }

    const project: HydratedProject = {
      id: DEMO_PROJECT_ID,
      name: DEMO_NAME,
      initialIdea: DEMO_INITIAL_IDEA,
      globalMemory: {
        longTermGoal: "成为腰部博主每天必开的选题工作台",
        userPreference:
          "口语化、具体、可执行；标题不堆叠感叹号；首段不超过 80 字",
        technicalConstraints:
          "Next.js + Vercel 免费层；LLM 用 DeepSeek（兼容 OpenAI 协议）",
        confirmedDecisions:
          "采用 3+1 结构 / 砍掉 V1 的锁定深挖 / 热词写死 30 条每周更新",
        excludedScope:
          "暂不做抖音、即刻、公众号；暂不做素人和头部博主",
        futureIdeas:
          "对标账号自定义、Vercel KV 存历史、MCN 团队版",
        risks:
          "热词时效性、LLM 偶发非法 JSON、标题钩子化反感",
        ideaSummary:
          "小红书 3+1 选题 Agent：每天 5 分钟搞定选题/角度/标题/首段",
        ideaTags: "AI,内容创作,小红书,选题",
        productBoundary: {
          targetUser: "小红书腰部博主（1k-5w 粉）",
          ioShape:
            "输入：垂类方向 + 人设标签 → 输出：3+1 选题卡片（标题/首段/标签/对标）",
          notDoing:
            "不做抖音、即刻；不做素人/头部；不做对标账号自定义（V2 再说）",
          notes: "演示项目 · 已预填全部 6 步内容，可直接查看完整流程",
          confirmedAt: NOW_BASELINE,
        },
        builderTestContext: "Red Finance Builder Test / 48 小时 Demo",
      },
      steps,
      finalPRD: FINAL_PRD,
      createdAt: NOW_BASELINE,
      updatedAt: NOW_BASELINE,
    };

    // Storage 没有「按指定 ID 创建」的方法，所以走低层 SQL
    // 这里复用 createProject + saveProject 的副作用：先 create 再 save 覆盖
    await storage.createProject({
      id: DEMO_PROJECT_ID,
      name: DEMO_NAME,
      initialIdea: DEMO_INITIAL_IDEA,
    });
    await storage.saveProject(project);

    console.log(
      `[seed] demo project created: ${DEMO_PROJECT_ID} (${DEMO_NAME}) ✅`,
    );
  } catch (err) {
    // 种子失败不影响应用启动 —— 至少首页空白还能用
    console.warn("[seed] failed to create demo project:", err);
  }
}
