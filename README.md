# Builder Demo Coach

48 小时 AI 产品教练 · 把一句话想法收敛成可演示、可提交的 Demo。

Step 0 边界 + 6 步 3+1 chip 化问答 + 三卡输出（PRD / README / Tasks）+ 小红书 Builder Test 提交说明。Mock 默认可用，状态条诚实告知 Mock / Real 来源。

> 在线 Demo：见 Perplexity Computer 链接 · 6 + 1 流程，单人浏览器闭环，不消耗 API 即可完整跑通。

---

## 技术栈

- **前端**：Vite + React 18 + Tailwind + shadcn/ui + wouter（hash routing）
- **后端**：Express 5 + better-sqlite3 + Drizzle ORM
- **共享层**：`shared/schema.ts` 既给前端做类型，又给后端做 schema 校验
- **部署**：单端口（Vite + Express 同进程），dist/public 静态 + dist/index.cjs 服务端

---

## 6 + 1 流程

| Step | 名称 | 作用 |
|------|------|------|
| 0 | 产品边界 | 目标用户 / 输入输出 / 首版不做什么 |
| 1 | 需求发现 | 真实问题 + 目标用户场景 |
| 2 | 问题定义 | 输入 / 输出 / 最短路径 |
| 3 | 方案设计 | AI 角色 / 技术形态 / 模型策略 |
| 4 | 最小 Demo | 最小闭环 + 砍掉的范围 |
| 5 | 实现路径 | 技术栈 + 48 小时排期 |
| 6 | 展示迭代 | Pitch + Roadmap |
| Final | 三卡输出 | PRD / README / Tasks + Submission Brief |

---

## Mock vs Real LLM

默认运行模式是 **Mock · 本地模板**：稳定、可复现、不消耗 API。它是一个有意识的工程取舍，不是缺陷 —— 评委 / 用户在没有 key 的情况下也能看到完整的产品流程与输出。

要切到 **Real LLM**，把 `.env.example` 复制为 `.env` 并填入：

```bash
USE_REAL_LLM=1
LLM_API_KEY=sk-...
LLM_PROVIDER=perplexity     # 可选，省略则从 base_url 推断
LLM_MODEL=sonar-pro
LLM_BASE_URL=https://api.perplexity.ai
```

支持任意 OpenAI-Compatible endpoint：

| 提供商 | LLM_BASE_URL | 推荐模型 |
|--------|--------------|----------|
| Perplexity | `https://api.perplexity.ai` | `sonar-pro` / `sonar-reasoning` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` / `deepseek-reasoner` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` / `gpt-4o` |
| 自托管 | 任意兼容地址 | 任意 |

### 三个真实 LLM 切入点

| 入口 | 文件 | 何时被调用 |
|------|------|----------|
| `summarizeIdea` | `server/agent.ts` | 创建 / 更新项目时压缩一句话想法 |
| `nextQuestionFor` | `server/agent.ts` | 每一步生成下一个引导问题 |
| `generateStepContent` | `server/agent.ts` | 每一步生成结构化结论（summary / risks / decisions / suggestedOutput …） |

每个入口都遵循同一个模式：
```ts
const real = await callLLM(...);
return real ?? mockImpl(...);
```

任意失败（超时 / 429 / 5xx / 鉴权错误 / 非法 JSON）会自动回落 Mock，并把失败原因写到 `/api/meta/agent-mode` 的 `lastError` 字段，前端状态条会从 `Real` 变成 `Mock` 并附上失败原因。

### 鲁棒性

`callRaw()` 内置：
- AbortController 超时（默认 25 s，可调 `LLM_TIMEOUT_MS`）
- 429 / 5xx 指数退避重试（默认 2 次，可调 `LLM_MAX_RETRIES`，遵循 `Retry-After`）
- JSON Schema 形态描述 + JSON 模式响应 + 容错解析（剥 ```json 围栏 / 取首尾 `{}` ）
- 模块级健康状态（`getLLMHealth()` 暴露给 routes）

---

## 评委模式

右上角一个按钮在 **评委模式 ↔ 编辑模式** 之间切换。评委模式只读：保留所有问答与生成结果、PRD/README/Tasks 预览、Submission Brief、Multi-Agent 编排面板与下载/复制按钮，隐藏所有编辑控件。

---

## 本地开发

```bash
npm install
npm run dev          # 同端口跑 Vite + Express
npm run build        # 产出 dist/public + dist/index.cjs
NODE_ENV=production node dist/index.cjs
```

环境变量见 `.env.example`。
