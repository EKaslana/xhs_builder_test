import { useQuery } from "@tanstack/react-query";
import { api, type AgentMode as AgentModeT } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Info, CircuitBoard, Sparkles } from "lucide-react";

export function useAgentMode() {
  return useQuery<AgentModeT>({
    queryKey: ["/api/meta/agent-mode"],
    queryFn: api.agentMode,
  });
}

export function AgentModeBar({ context }: { context?: "step" | "prd" | "submission" }) {
  const { data } = useAgentMode();
  if (!data) return null;
  const isMock = data.mode === "mock";
  const isPending = data.mode === "real-pending";
  const colorClass = isMock
    ? "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200"
    : isPending
      ? "bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800/60 text-sky-900 dark:text-sky-200"
      : "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200";
  const label = isMock ? "Mock" : isPending ? "Real 待首调" : "Real";
  return (
    <div
      className={`flex items-center gap-3 px-4 py-2 border rounded-md text-sm ${colorClass}`}
      data-testid="agent-mode-bar"
    >
      <span className="inline-flex items-center gap-1.5 font-semibold">
        {isMock ? <CircuitBoard className="size-4" /> : <Sparkles className="size-4" />}
        [{label}]
      </span>
      <span className="hidden sm:inline opacity-90">
        生成模式：{isMock ? "Mock · 本地模板" : `${label} · ${data.provider}`} · 模型：
        {data.model} · {data.consumesApi ? "消耗 API" : "不消耗 API"} ·{" "}
        {data.reproducible ? "可复现" : "不可复现"}
      </span>
      <span className="sm:hidden">
        {isMock ? "本地模板" : data.provider}
      </span>
      <Popover>
        <PopoverTrigger className="ml-auto inline-flex items-center gap-1 whitespace-nowrap shrink-0 underline underline-offset-2 hover:opacity-80">
          <Info className="size-3.5 shrink-0" />
          <span className="whitespace-nowrap">详情</span>
        </PopoverTrigger>
        <PopoverContent className="w-96 text-xs space-y-2" data-testid="agent-mode-details">
          <div className="rounded-md border bg-muted/40 p-2.5 space-y-1">
            <div className="font-semibold text-sm">运行模式说明</div>
            <div className="leading-relaxed text-foreground/85">
              当前 Demo 为稳定可复现的 Mock 运行；真实 LLM 可通过
              <span className="font-medium"> Perplexity / DeepSeek / OpenAI-compatible endpoint </span>
              接入。Mock 为默认可用状态，是为了交付可复现、不消耗 API 的有意识工程取舍。
            </div>
          </div>
          <div className="font-semibold text-sm pt-1">本次执行路径</div>
          <div>context：{context || "global"}</div>
          <div>generateStep / nextQuestion / summarizeIdea 本次走 {data.mode}</div>
          {data.lastError && (
            <div className="text-amber-700 dark:text-amber-300">
              最近一次 LLM 调用失败：{data.lastError}（已自动回落 Mock）
            </div>
          )}
          <div className="border-t pt-2 mt-2 space-y-1">
            <div>provider：{data.provider}</div>
            <div>model：{data.model}</div>
            <div>baseUrl：{data.baseUrl || "—"}</div>
            <div>consumesApi：{String(data.consumesApi)}</div>
            <div>reproducible：{String(data.reproducible)}</div>
            <div>auxMode（idea / 冲突）：{data.auxMode}</div>
            <div>realCapable：{String(data.realCapable)}</div>
            <div>lastStepCallSucceeded：{String(data.lastStepCallSucceeded)}</div>
          </div>
          <div className="border-t pt-2 mt-2">
            <div className="font-semibold mb-1">如何切到 Real？</div>
            <pre className="bg-muted rounded p-2 overflow-x-auto text-[11px]">
{`USE_REAL_LLM=1
LLM_API_KEY=sk-...
LLM_PROVIDER=perplexity
LLM_MODEL=sonar-pro
LLM_BASE_URL=https://api.perplexity.ai`}
            </pre>
            <div className="text-[11px] opacity-80 mt-1">
              环境变量 + 启用 server/agent.ts 的 callLLM 真实路径。
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function AgentModeBadge({ context }: { context: "step" | "prd" | "submission" }) {
  const { data } = useAgentMode();
  if (!data) return null;
  const isMock = data.mode === "mock";
  const isPending = data.mode === "real-pending";
  const cls = isMock
    ? "border-amber-400/60 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    : isPending
      ? "border-sky-400/60 bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200"
      : "border-emerald-400/60 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200";
  const label = isMock ? "Mock" : isPending ? "Real 待首调" : "Real";
  return (
    <Badge
      variant="outline"
      className={cls}
      data-testid={`badge-agent-${context}`}
    >
      {label} · {data.model}
    </Badge>
  );
}

export function AgentModeFooter() {
  const { data } = useAgentMode();
  if (!data) return null;
  return (
    <div className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground flex items-center justify-between">
      <span>
        Provenance：mode = <span className="font-mono">{data.mode}</span> · auxMode ={" "}
        <span className="font-mono">{data.auxMode}</span> · model ={" "}
        <span className="font-mono">{data.model}</span>
      </span>
      <span>realCapable：{String(data.realCapable)}</span>
    </div>
  );
}
