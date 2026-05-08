import { useState, useEffect, useMemo, createContext, useContext } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import {
  STEP_IDS,
  STEP_META,
  type StepId,
  type HydratedProject,
} from "@shared/schema";
import { api, type SubagentReport, type ExportsResponse } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  AgentModeBar,
  AgentModeBadge,
  AgentModeFooter,
} from "@/components/AgentMode";
import {
  ChevronRight,
  Lock,
  Unlock,
  Sparkles,
  Copy,
  Download,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Bot,
  ScrollText,
  ClipboardList,
  Send,
  ListChecks,
  ShieldCheck,
  PencilLine,
  Eye,
  Edit3,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Presenter mode (评委模式 / 展示模式)
// ---------------------------------------------------------------------------
const PresenterCtx = createContext(false);
function usePresenter() { return useContext(PresenterCtx); }

type StepKey = StepId | "boundary" | "final";
const VALID_STEPS: StepKey[] = ["boundary", ...STEP_IDS, "final"];

function isStepKey(v: string | undefined): v is StepKey {
  return !!v && (VALID_STEPS as string[]).includes(v);
}

function useNavStep() {
  const [, setLoc] = useLocation();
  return (projectId: string, step: StepKey) => {
    setLoc(`/project/${projectId}/${step}`);
  };
}

function provenanceLabel(src: string): string {
  if (src === "project_data") return "项目数据";
  if (src === "step0_boundary") return "Step 0 边界";
  if (src === "global_memory") return "全局记忆";
  if (src.startsWith("step:")) {
    const id = src.slice(5) as StepId;
    const meta = STEP_META[id];
    return meta ? `${meta.name} 步骤` : `${id} 步骤`;
  }
  return src;
}

function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function copyText(text: string, ok: () => void, fail: (e: any) => void) {
  // Sandboxed iframe may block navigator.clipboard; fallback to textarea trick.
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(ok, () => fallback());
      return;
    }
    fallback();
  } catch (e) {
    fail(e);
  }
  function fallback() {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      ok();
    } catch (e) {
      fail(e);
    }
  }
}

// ---------------------------------------------------------------------------
export default function Project() {
  const [matchWithStep, paramsWithStep] = useRoute("/project/:id/:step");
  const [matchBare, paramsBare] = useRoute("/project/:id");
  const id = ((paramsWithStep as any)?.id ?? (paramsBare as any)?.id) as
    | string
    | undefined;
  if ((!matchWithStep && !matchBare) || !id) return null;
  const rawStep = (paramsWithStep as any)?.step as string | undefined;
  const step: StepKey = isStepKey(rawStep) ? rawStep : "boundary";
  return <ProjectInner id={id} stepParam={step} />;
}

function ProjectInner({ id, stepParam }: { id: string; stepParam: StepKey }) {
  const { data: project, isLoading } = useQuery<HydratedProject>({
    queryKey: ["/api/projects", id],
    queryFn: () => api.getProject(id),
  });
  const [presenter, setPresenter] = useState(false);

  if (isLoading || !project) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">
        载入项目中…
      </div>
    );
  }

  return (
    <PresenterCtx.Provider value={presenter}>
      <div className="min-h-screen flex flex-col bg-background">
        <ProjectTopNav
          project={project}
          presenter={presenter}
          onTogglePresenter={() => setPresenter((p) => !p)}
        />
        <div className="flex-1 flex">
          <StepNav project={project} active={stepParam} />
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-4xl mx-auto px-6 py-6">
              {!presenter && (
                <AgentModeBar context={stepParam === "final" ? "prd" : "step"} />
              )}
              {presenter && (
                <div className="rounded-md border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 px-4 py-2.5 text-sm flex items-center gap-2">
                  <Eye className="size-4 text-emerald-700 dark:text-emerald-300" />
                  <span className="font-medium text-emerald-800 dark:text-emerald-200">评委模式</span>
                  <span className="text-emerald-700/80 dark:text-emerald-300/80">
                    只读展示。问题 / 方案 / 6 步内容 / 提交字段 / Multi-Agent 贡献一目了然。
                  </span>
                </div>
              )}
              <div className="mt-6">
                {stepParam === "boundary" && <BoundaryStep0 project={project} />}
                {STEP_IDS.includes(stepParam as StepId) && (
                  <StepEditor project={project} stepId={stepParam as StepId} />
                )}
                {stepParam === "final" && <PRDPreview project={project} />}
              </div>
            </div>
            <AgentModeFooter />
          </main>
        </div>
      </div>
    </PresenterCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
function ProjectTopNav({
  project,
  presenter,
  onTogglePresenter,
}: {
  project: HydratedProject;
  presenter: boolean;
  onTogglePresenter: () => void;
}) {
  const exportSnapshot = async () => {
    const snap = await api.snapshot(project.id);
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name}.snapshot.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <header className="border-b bg-card">
      <div className="px-6 py-3 flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="sm" data-testid="button-back-home">
            <ArrowLeft className="mr-1.5 size-4" />
            项目列表
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate" data-testid="text-project-name">{project.name}</div>
          <div className="text-xs text-muted-foreground truncate">
            {project.globalMemory.ideaSummary || project.initialIdea}
          </div>
        </div>
        <Button
          variant={presenter ? "default" : "outline"}
          size="sm"
          onClick={onTogglePresenter}
          data-testid="button-toggle-presenter"
          title={presenter ? "返回编辑模式" : "切到只读展示页（适合评委 / 提交链接被打开后的首屏）"}
        >
          {presenter ? (
            <>
              <Edit3 className="mr-1.5 size-4" />
              编辑模式
            </>
          ) : (
            <>
              <Eye className="mr-1.5 size-4" />
              评委模式
            </>
          )}
        </Button>
        <Button variant="outline" size="sm" onClick={exportSnapshot} data-testid="button-export-snapshot">
          <Download className="mr-1.5 size-4" />
          Snapshot JSON
        </Button>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
function StepNav({ project, active }: { project: HydratedProject; active: StepKey }) {
  const setStepParam = useNavStep();
  const items: { key: StepKey; label: string; sub?: string }[] = [
    { key: "boundary", label: "Step 0", sub: "产品边界" },
    ...STEP_IDS.map((id) => ({
      key: id as StepKey,
      label: STEP_META[id].name,
      sub: STEP_META[id].subtitle,
    })),
    { key: "final", label: "最终输出", sub: "PRD / README / Tasks / Submission" },
  ];
  const stepStatus = (k: StepKey) => {
    if (k === "boundary") return project.globalMemory.productBoundary.confirmedAt ? "done" : "pending";
    if (k === "final") return "open";
    const s = project.steps[k as StepId];
    if (s.locked) return "locked";
    if (s.generatedContent) return "done";
    if (s.qaComplete) return "ready";
    return "pending";
  };
  return (
    <nav className="hidden md:block w-60 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="px-4 py-4 text-xs uppercase tracking-wide opacity-70">
        6 + 1 流程
      </div>
      <ul className="px-2 space-y-1 pb-6">
        {items.map((it, idx) => {
          const isActive = active === it.key;
          const status = stepStatus(it.key);
          return (
            <li key={it.key}>
              <button
                onClick={() => setStepParam(project.id, it.key)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors hover-elevate flex items-start gap-2 ${
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "hover:bg-sidebar-accent"
                }`}
                data-testid={`nav-step-${it.key}`}
              >
                <span className="font-mono text-xs opacity-70 mt-0.5 w-5 shrink-0">
                  {idx === 0 ? "0" : idx === items.length - 1 ? "✓" : idx}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-medium">{it.label}</span>
                  {it.sub && <span className="block text-[11px] opacity-70 truncate">{it.sub}</span>}
                </span>
                <StatusDot status={status} />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    done: "bg-emerald-400",
    ready: "bg-amber-400",
    locked: "bg-violet-400",
    pending: "bg-zinc-500/40",
    open: "bg-sky-400",
  };
  return <span className={`mt-1.5 size-2 rounded-full shrink-0 ${map[status] || map.pending}`} />;
}

// ===========================================================================
// Step 0: Boundary
// ===========================================================================
function BoundaryStep0({ project }: { project: HydratedProject }) {
  const setStepParam = useNavStep();
  const presenter = usePresenter();
  const { toast } = useToast();
  const { data: opts } = useQuery({
    queryKey: ["/api/projects", project.id, "boundary", "options"],
    queryFn: () => api.boundaryOptions(project.id),
  });
  const b = project.globalMemory.productBoundary;
  const [targetUser, setTargetUser] = useState(b.targetUser);
  const [ioShape, setIoShape] = useState(b.ioShape);
  const [notDoing, setNotDoing] = useState(b.notDoing);
  const [notes, setNotes] = useState(b.notes);

  const draftMut = useMutation({
    mutationFn: (body: any) => api.boundaryDraft(project.id, body),
    onSuccess: (p) => queryClient.setQueryData(["/api/projects", project.id], p),
  });
  const confirmMut = useMutation({
    mutationFn: () => api.boundaryConfirm(project.id, { targetUser, ioShape, notDoing, notes }),
    onSuccess: (p) => {
      queryClient.setQueryData(["/api/projects", project.id], p);
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Step 0 边界已确认", description: "进入需求发现（Discovery）" });
      setStepParam(project.id, "discovery");
    },
  });

  const saveDraft = (patch: any) => draftMut.mutate(patch);

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">Step 0</Badge>
          <span>产品边界 · 进入 6 步前的前置确认</span>
        </div>
        <h2 className="text-2xl font-semibold mt-2">先把首版边界三选一确定</h2>
        <p className="text-muted-foreground mt-1">
          目标用户、输入输出、首版范围 + 自由补充。每次选择都会即时保存草稿。
        </p>
      </header>

      <BoundaryField
        label="目标用户"
        value={targetUser}
        onChange={(v) => {
          setTargetUser(v);
          saveDraft({ targetUser: v });
        }}
        options={opts?.targetUser?.options || []}
        insights={opts?.targetUser?.insights || {}}
        testid="boundary-target-user"
      />
      <BoundaryField
        label="输入与输出"
        value={ioShape}
        onChange={(v) => {
          setIoShape(v);
          saveDraft({ ioShape: v });
        }}
        options={opts?.ioShape?.options || []}
        insights={opts?.ioShape?.insights || {}}
        testid="boundary-io-shape"
      />
      <BoundaryField
        label="首版范围"
        value={notDoing}
        onChange={(v) => {
          setNotDoing(v);
          saveDraft({ notDoing: v });
        }}
        options={opts?.notDoing?.options || []}
        insights={opts?.notDoing?.insights || {}}
        testid="boundary-not-doing"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">自由补充</CardTitle>
          <CardDescription>
            {presenter ? "补充说明（只读）" : "不在选项里的边界判断，可以写在这里。"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {presenter ? (
            <p className="text-sm whitespace-pre-wrap text-foreground/80 min-h-[24px]">
              {notes || "——"}
            </p>
          ) : (
            <Textarea
              value={notes}
              rows={3}
              onChange={(e) => {
                setNotes(e.target.value);
                saveDraft({ notes: e.target.value });
              }}
              placeholder="例：暂时只面向中文用户；只支持桌面浏览器。"
              data-testid="textarea-boundary-notes"
            />
          )}
        </CardContent>
      </Card>

      {!presenter && (
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm text-muted-foreground">
            {b.confirmedAt
              ? `已于 ${new Date(b.confirmedAt).toLocaleString()} 确认。重新点击会更新边界。`
              : "确认边界后会进入「需求发现」步骤。"}
          </div>
          <Button
            onClick={() => confirmMut.mutate()}
            disabled={!targetUser || !ioShape || !notDoing || confirmMut.isPending}
            data-testid="button-confirm-boundary"
          >
            {confirmMut.isPending ? "保存中…" : "确认边界并继续"}
            <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function BoundaryField({
  label,
  value,
  onChange,
  options,
  insights,
  testid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  insights: Record<string, string>;
  testid: string;
}) {
  const presenter = usePresenter();
  const [free, setFree] = useState("");
  const inOpts = options.includes(value);

  if (presenter) {
    const insight = inOpts ? insights[value] : undefined;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{label}</CardTitle>
        </CardHeader>
        <CardContent>
          {value ? (
            <div className="rounded-md border bg-primary/5 border-primary/30 px-3 py-2.5">
              <div className="font-medium text-sm">{value}</div>
              {insight && (
                <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{insight}</div>
              )}
              {!inOpts && (
                <Badge variant="outline" className="mt-2">自由输入</Badge>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">未填写</div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 md:grid-cols-3">
          {options.map((opt) => {
            const active = value === opt;
            return (
              <button
                key={opt}
                onClick={() => onChange(opt)}
                className={`text-left p-3 rounded-md border text-sm transition-colors hover-elevate ${
                  active
                    ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                    : "border-border bg-card"
                }`}
                data-testid={`${testid}-option-${options.indexOf(opt)}`}
              >
                <div className="font-medium leading-snug">{opt}</div>
                {insights[opt] && (
                  <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                    {insights[opt]}
                  </div>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2 items-center">
          <Input
            value={inOpts ? "" : value || free}
            onChange={(e) => {
              const v = e.target.value;
              setFree(v);
              onChange(v);
            }}
            placeholder="自由补充（也可以与选项不同的措辞）"
            data-testid={`${testid}-free`}
          />
          {!inOpts && value && <Badge variant="outline">自由输入</Badge>}
        </div>
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Step Editor (1-6)
// ===========================================================================
function StepEditor({ project, stepId }: { project: HydratedProject; stepId: StepId }) {
  const setStepParam = useNavStep();
  const presenter = usePresenter();
  const meta = STEP_META[stepId];
  const step = project.steps[stepId];
  const { toast } = useToast();

  const { data: nextQ, refetch: refetchNext } = useQuery({
    queryKey: ["/api/projects", project.id, "qa", stepId, "next", step.qa.length],
    queryFn: () => api.qaNext(project.id, stepId),
  });

  const [selected, setSelected] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [conflict, setConflict] = useState<any>(null);

  useEffect(() => {
    setSelected([]);
    setFreeText("");
    setConflict(null);
  }, [nextQ?.question?.questionId, stepId]);

  const answerMut = useMutation({
    mutationFn: () =>
      api.qaAnswer(project.id, stepId, {
        questionId: nextQ?.question?.questionId,
        question: nextQ?.question?.question,
        targetField: nextQ?.question?.targetField,
        options: nextQ?.question?.options || [],
        selectedOptions: selected,
        freeText,
      }),
    onSuccess: (resp) => {
      if (resp.conflict) {
        setConflict(resp);
        return;
      }
      queryClient.setQueryData(["/api/projects", project.id], resp.project);
      refetchNext();
    },
    onError: (e: any) => toast({ title: "保存失败", description: String(e?.message), variant: "destructive" }),
  });

  const resolveMut = useMutation({
    mutationFn: (keep: "prior" | "new") =>
      api.qaResolve(project.id, stepId, {
        keep,
        priorQuestionId: conflict?.conflict?.priorQuestionId,
        candidate: conflict?.candidate,
      }),
    onSuccess: (resp) => {
      queryClient.setQueryData(["/api/projects", project.id], resp.project);
      setConflict(null);
      refetchNext();
    },
  });

  const resetMut = useMutation({
    mutationFn: () => api.qaReset(project.id, stepId),
    onSuccess: (resp) => {
      queryClient.setQueryData(["/api/projects", project.id], resp.project);
      refetchNext();
    },
  });

  const generateMut = useMutation({
    mutationFn: () => api.generate(project.id, stepId),
    onSuccess: (resp) => {
      queryClient.setQueryData(["/api/projects", project.id], resp.project);
      // Refresh agent-mode banner so Real/Mock reflects the actual call result
      queryClient.invalidateQueries({ queryKey: ["/api/meta/agent-mode"] });
      const modeLabel = resp.mode === "real" ? "Real LLM" : "Mock 本地模板";
      toast({ title: "已生成", description: `${meta.name} 的输出已就绪（${modeLabel}）` });
    },
  });

  const lockMut = useMutation({
    mutationFn: (lock: boolean) => api.lockStep(project.id, stepId, lock),
    onSuccess: (p) => queryClient.setQueryData(["/api/projects", project.id], p),
  });

  const stepIdx = STEP_IDS.indexOf(stepId);
  const goNext = () => {
    if (stepIdx < STEP_IDS.length - 1) setStepParam(project.id, STEP_IDS[stepIdx + 1]);
    else setStepParam(project.id, "final");
  };

  const oneLineRecap = useMemo(() => {
    const recap: string[] = [];
    if (project.globalMemory.productBoundary.confirmedAt) {
      const b = project.globalMemory.productBoundary;
      recap.push(`边界：${b.targetUser} · ${b.ioShape}`);
    }
    for (const id of STEP_IDS) {
      if (id === stepId) break;
      const s = project.steps[id];
      if (s.generatedContent) recap.push(`${STEP_META[id].name}：${s.generatedContent.summary.slice(0, 60)}`);
    }
    return recap.join(" | ");
  }, [project, stepId]);

  return (
    <div className="space-y-6 pb-12">
      <header>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">第 {stepIdx + 1} 步</Badge>
          <span>{meta.subtitle}</span>
        </div>
        <h2 className="text-2xl font-semibold mt-2">{meta.name}</h2>
        <p className="text-muted-foreground mt-1">{meta.description}</p>
      </header>

      {oneLineRecap && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">回顾</span> · {oneLineRecap}
        </div>
      )}

      {/* Guided QA */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="size-4 text-primary" /> 引导问答
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">已答 {step.qa.length}</Badge>
              {!presenter && (
                <Button variant="ghost" size="sm" onClick={() => resetMut.mutate()} data-testid="button-reset-qa">
                  <RefreshCw className="mr-1 size-3.5" />
                  重置
                </Button>
              )}
            </div>
          </div>
          <CardDescription>每题 3 个同维度选项 + 1 个自由补充。提交一题立即写入后端。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step.qa.length > 0 && (
            <div className="space-y-2">
              {step.qa.map((q) => (
                <div key={q.questionId} className="text-sm border rounded-md px-3 py-2 bg-muted/20">
                  <div className="font-medium">{q.question}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {q.selectedOptions.join("、")}
                    {q.freeText && (q.selectedOptions.length ? "；" : "") + q.freeText}
                  </div>
                </div>
              ))}
            </div>
          )}

          {presenter ? (
            <div className="text-xs text-muted-foreground">展示模式：仅查看已回答的问题与生成结果，互动控件已隐藏。</div>
          ) : step.locked ? (
            <div className="text-sm text-muted-foreground">步骤已锁定，无法继续追加问答。</div>
          ) : nextQ?.done ? (
            <div className="text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
              <CheckCircle2 className="size-4" />
              本步问答已完成，可以生成本步骤。
            </div>
          ) : nextQ?.question ? (
            <div className="space-y-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1">维度：{nextQ.question.dimensionLabel || ""}</div>
                <div className="font-medium">{nextQ.question.question}</div>
                {nextQ.question.rationale && (
                  <div className="text-xs text-muted-foreground mt-1">{nextQ.question.rationale}</div>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                同一维度下三选一（再点一下可取消）· 或在下方自由补充
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {nextQ.question.options.map((opt: string, i: number) => {
                  const active = selected.includes(opt);
                  return (
                    <button
                      key={opt}
                      onClick={() =>
                        // 单选语义：同一维度上只能选 1 个。再点一下取消。
                        setSelected((s) => (s.includes(opt) ? [] : [opt]))
                      }
                      className={`text-left p-3 rounded-md border text-sm hover-elevate ${
                        active
                          ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                          : "border-border bg-card"
                      }`}
                      data-testid={`qa-option-${i}`}
                    >
                      <div className="font-medium leading-snug">{opt}</div>
                      {nextQ.question.optionInsights?.[opt] && (
                        <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                          {nextQ.question.optionInsights[opt]}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <Textarea
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                rows={2}
                placeholder="不选项也可以：直接在这里写你自己的答案"
                data-testid="qa-free-text"
              />
              <div className="flex justify-end">
                <Button
                  onClick={() => answerMut.mutate()}
                  disabled={(selected.length === 0 && !freeText.trim()) || answerMut.isPending}
                  data-testid="button-answer-submit"
                >
                  <Send className="mr-1.5 size-4" />
                  {answerMut.isPending ? "保存中…" : "提交本题"}
                </Button>
              </div>
            </div>
          ) : null}

          {!presenter && conflict && (
            <div className="rounded-md border border-amber-400/60 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
                <AlertTriangle className="size-4" />
                检测到冲突
              </div>
              <div className="text-xs text-amber-900/80 dark:text-amber-200/80 mt-1">
                {conflict.conflict.reason}
              </div>
              <div className="mt-2 text-xs space-y-1">
                <div>
                  <span className="font-medium">之前：</span>
                  {conflict.conflict.priorAnswer}
                </div>
                <div>
                  <span className="font-medium">现在：</span>
                  {conflict.conflict.newAnswer}
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <Button size="sm" variant="outline" onClick={() => resolveMut.mutate("prior")}>
                  保留之前
                </Button>
                <Button size="sm" onClick={() => resolveMut.mutate("new")}>
                  采用最新
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Generate */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="size-4 text-primary" /> 生成本步骤
            </CardTitle>
            <div className="flex items-center gap-2">
              <AgentModeBadge context="step" />
              {!presenter && (
                <Button
                  onClick={() => generateMut.mutate()}
                  disabled={!step.qaComplete || step.locked || generateMut.isPending}
                  data-testid="button-generate-step"
                >
                  {generateMut.isPending ? "生成中…" : step.generatedContent ? "重新生成" : "生成"}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {step.generatedContent ? (
            <div className="space-y-3">
              <div className="text-sm">{step.generatedContent.summary}</div>
              <div className="grid gap-3 md:grid-cols-2">
                <SmallBlock title="决策" items={step.generatedContent.decisions} />
                <SmallBlock title="风险" items={step.generatedContent.risks} />
                <SmallBlock title="关键问题" items={step.generatedContent.keyQuestions} />
                <SmallBlock title="扩展空间" items={step.generatedContent.extensionSpace} />
              </div>
              <details className="rounded-md border bg-muted/20 p-3">
                <summary className="text-sm cursor-pointer">展开完整分析（折叠不删数据）</summary>
                <pre className="text-xs whitespace-pre-wrap mt-2 leading-relaxed">
                  {step.generatedContent.analysis}
                </pre>
              </details>
              <div className="text-xs text-muted-foreground">{step.generatedContent.nextStepHint}</div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              完成至少 {2} 题问答后即可生成。生成结果会保留全文，UI 仅展示折叠态。
            </div>
          )}
        </CardContent>
      </Card>

      {/* Footer actions */}
      {!presenter && (
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            onClick={() => lockMut.mutate(!step.locked)}
            data-testid="button-lock-step"
          >
            {step.locked ? <Unlock className="mr-1 size-4" /> : <Lock className="mr-1 size-4" />}
            {step.locked ? "解锁步骤" : "锁定步骤"}
          </Button>
          <Button onClick={goNext} disabled={!step.generatedContent} data-testid="button-next-step">
            {stepIdx === STEP_IDS.length - 1 ? "进入最终输出" : `下一步：${STEP_META[STEP_IDS[stepIdx + 1]].name}`}
            <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function SmallBlock({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs font-medium text-muted-foreground mb-1.5">{title}</div>
      <ul className="text-sm space-y-1">
        {items.map((it, i) => (
          <li key={i} className="leading-relaxed">
            • {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ===========================================================================
// Final: PRD / README / Tasks / Submission Brief / Subagent Panel
// ===========================================================================
function PRDPreview({ project }: { project: HydratedProject }) {
  const [publicLink, setPublicLink] = useState("");
  const { data: exp } = useQuery({
    queryKey: ["/api/projects", project.id, "exports", publicLink],
    queryFn: () => api.exports(project.id, publicLink),
  });
  const { data: orch } = useQuery({
    queryKey: ["/api/projects", project.id, "orchestrator", publicLink],
    queryFn: () => api.orchestrator(project.id, publicLink),
  });
  const { toast } = useToast();
  const onCopy = (text: string, label: string) =>
    copyText(
      text,
      () => toast({ title: "已复制", description: label }),
      () => toast({ title: "复制失败，请手动选中", variant: "destructive" }),
    );

  if (!exp || !orch) return <div className="text-muted-foreground">载入交付物中…</div>;

  return (
    <div className="space-y-8 pb-12">
      <header>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">最终输出</Badge>
          <span>6 + 1 流程的产出页（不计入 6 步）</span>
        </div>
        <h2 className="text-2xl font-semibold mt-2">三卡输出 + Builder Test 提交说明</h2>
        <p className="text-muted-foreground mt-1">
          每个交付物独立 readiness 标记。Mock 路径下也保证非空、可读、可下载。
        </p>
      </header>

      <ReadinessRow exp={exp} />

      {/* Three cards */}
      <Tabs defaultValue="prd">
        <TabsList>
          <TabsTrigger value="prd" data-testid="tab-prd">
            <ScrollText className="mr-1.5 size-4" /> PRD
          </TabsTrigger>
          <TabsTrigger value="readme" data-testid="tab-readme">README</TabsTrigger>
          <TabsTrigger value="tasks" data-testid="tab-tasks">
            <ClipboardList className="mr-1.5 size-4" /> 任务清单
          </TabsTrigger>
        </TabsList>
        <TabsContent value="prd">
          <DeliverableCard
            title="产品需求文档（PRD）"
            mode={exp.prd.mode}
            md={exp.prd.markdown}
            ok={exp.readiness.prd.ok}
            missing={exp.readiness.prd.missing}
            filename={`${project.name}.prd.md`}
            onCopy={onCopy}
          />
        </TabsContent>
        <TabsContent value="readme">
          <DeliverableCard
            title="README"
            md={exp.readme.markdown}
            ok={exp.readiness.readme.ok}
            missing={exp.readiness.readme.missing}
            filename={`${project.name}.README.md`}
            onCopy={onCopy}
          />
        </TabsContent>
        <TabsContent value="tasks">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">产品概览</TabsTrigger>
              <TabsTrigger value="engineering">工程拆解</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <DeliverableCard
                title="产品概览任务"
                md={exp.overviewTasks.markdown}
                ok={exp.readiness.overviewTasks.ok}
                missing={exp.readiness.overviewTasks.missing}
                filename={`${project.name}.tasks.overview.md`}
                onCopy={onCopy}
              />
            </TabsContent>
            <TabsContent value="engineering">
              <DeliverableCard
                title="工程拆解任务"
                md={exp.engineeringTasks.markdown}
                ok={exp.readiness.engineeringTasks.ok}
                missing={exp.readiness.engineeringTasks.missing}
                filename={`${project.name}.tasks.engineering.md`}
                onCopy={onCopy}
              />
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>

      {/* Builder Test Submission Brief */}
      <SubmissionBriefBlock
        project={project}
        exp={exp}
        publicLink={publicLink}
        setPublicLink={setPublicLink}
        onCopy={onCopy}
      />

      {/* Multi-Agent Orchestrator Panel */}
      <SubagentPanel reports={orch.reports} />
    </div>
  );
}

function ReadinessRow({ exp }: { exp: ExportsResponse }) {
  const items = [
    { key: "prd", label: "PRD", state: exp.readiness.prd },
    { key: "readme", label: "README", state: exp.readiness.readme },
    { key: "overviewTasks", label: "Tasks (产品概览)", state: exp.readiness.overviewTasks },
    { key: "engineeringTasks", label: "Tasks (工程)", state: exp.readiness.engineeringTasks },
    { key: "submissionBrief", label: "Submission Brief", state: exp.readiness.submissionBrief },
  ];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ListChecks className="size-4" /> 交付物 readiness
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 md:grid-cols-5">
        {items.map((it) => (
          <div
            key={it.key}
            className={`rounded-md border p-3 text-xs ${
              it.state.ok
                ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900"
                : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900"
            }`}
            data-testid={`readiness-${it.key}`}
          >
            <div className="font-medium flex items-center gap-1.5">
              {it.state.ok ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
              {it.label}
            </div>
            <div className="opacity-80 mt-1">
              {it.state.ok ? "可导出" : `待补 ${it.state.missing.length} 项`}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DeliverableCard({
  title,
  mode,
  md,
  ok,
  missing,
  filename,
  onCopy,
}: {
  title: string;
  mode?: string;
  md: string;
  ok: boolean;
  missing: StepId[];
  filename: string;
  onCopy: (s: string, label: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="mt-1">
              {ok ? (
                <span className="text-emerald-700 dark:text-emerald-400">readiness 通过</span>
              ) : (
                <span className="text-amber-700 dark:text-amber-300">
                  缺失 {missing.length} 步
                  {missing.length ? `（${missing.map((m) => STEP_META[m].name).join("、")}）` : ""}
                </span>
              )}
              {mode && <span className="ml-2">· 模式：{mode}</span>}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onCopy(md, title)}>
              <Copy className="mr-1.5 size-3.5" />
              复制
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadMarkdown(filename, md)}>
              <Download className="mr-1.5 size-3.5" />
              下载 .md
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[420px] rounded-md border bg-muted/20">
          <pre className="text-xs whitespace-pre-wrap p-4 leading-relaxed font-mono">{md}</pre>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function SubmissionBriefBlock({
  project,
  exp,
  publicLink,
  setPublicLink,
  onCopy,
}: {
  project: HydratedProject;
  exp: ExportsResponse;
  publicLink: string;
  setPublicLink: (v: string) => void;
  onCopy: (s: string, label: string) => void;
}) {
  const presenter = usePresenter();
  const x = exp.submissionBrief.xhsFields;
  const fields = [
    { key: "demoName", label: "AI Demo 名称", value: x.demoName },
    { key: "demoLink", label: "Demo 链接", value: x.demoLink },
    { key: "demoDescription", label: "Demo 说明", value: x.demoDescription },
    { key: "whyThisSolution", label: "为什么做这个解决方案", value: x.whyThisSolution },
    { key: "implementationDetails", label: "具体是怎么实现的", value: x.implementationDetails },
    { key: "learnings", label: "做完之后有没有新的启发和发现", value: x.learnings },
  ];
  const allText = fields.map((f) => `## ${f.label}\n${f.value}`).join("\n\n");
  const linkOk = exp.demoLinkOk;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Send className="size-4" /> 小红书 Builder Test 提交字段
              <AgentModeBadge context="submission" />
            </CardTitle>
            <CardDescription className="mt-1">
              {exp.readiness.submissionBrief.ok ? (
                <span className="text-emerald-700 dark:text-emerald-400">提交字段已就绪，可以复制到表单</span>
              ) : (
                <span className="text-amber-700 dark:text-amber-300">
                  Submission Brief 待补：
                  {!linkOk && "需要补 Demo 链接；"}
                  {!project.globalMemory.productBoundary.confirmedAt && "Step 0 边界未确认；"}
                  {exp.readiness.submissionBrief.missing.map((m) => STEP_META[m].name).join("、")}
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onCopy(allText, "全部 6 字段")} data-testid="button-copy-all-xhs">
              <Copy className="mr-1.5 size-3.5" />
              复制全部
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadMarkdown(`${project.name}.submission-brief.md`, exp.submissionBrief.markdown)}
              data-testid="button-download-submission"
            >
              <Download className="mr-1.5 size-3.5" />
              下载 .md
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {presenter ? (
          publicLink ? (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">公开 Demo 链接</div>
              <a
                href={publicLink}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-primary underline break-all"
                data-testid="link-public-demo"
              >
                {publicLink}
              </a>
            </div>
          ) : null
        ) : (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground flex items-center gap-1">
              <PencilLine className="size-3" />
              填入公开 Demo 链接（部署 / 仓库 / 录屏 / Perplexity 公开页面）
            </label>
            <Input
              placeholder="https://your-demo.example.com"
              value={publicLink}
              onChange={(e) => setPublicLink(e.target.value)}
              data-testid="input-public-link"
            />
            {!linkOk && (
              <div className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" />
                需要补一个能直接打开看到作品的地址。
              </div>
            )}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key} className="rounded-md border bg-card p-3" data-testid={`xhs-field-${f.key}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-muted-foreground">{f.label}</div>
                <Button variant="ghost" size="sm" onClick={() => onCopy(f.value, f.label)}>
                  <Copy className="size-3" />
                </Button>
              </div>
              <pre className="text-xs whitespace-pre-wrap leading-relaxed">{f.value}</pre>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Multi-Agent Subagent Panel
// ===========================================================================
const ROLE_META: Record<SubagentReport["role"], { icon: any; tone: string }> = {
  problem_discovery: { icon: Bot, tone: "bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-900" },
  boundary_coach: { icon: ShieldCheck, tone: "bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-900" },
  prd: { icon: ScrollText, tone: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900" },
  build_planner: { icon: ClipboardList, tone: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900" },
  pitch: { icon: Send, tone: "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900" },
  validation: { icon: ShieldCheck, tone: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900" },
};

function SubagentPanel({ reports }: { reports: SubagentReport[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Bot className="size-4" /> Multi-Agent 编排面板（v1）
        </CardTitle>
        <CardDescription>
          Orchestrator 顺序调度 6 个 Subagent。每个 Subagent 输出可追溯到项目数据 / Step 0 边界 / 6 步内容。v1 不要求并发执行。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {reports.map((r) => {
          const m = ROLE_META[r.role];
          const Icon = m.icon;
          return (
            <div key={r.role} className={`rounded-md border p-4 ${m.tone}`} data-testid={`subagent-${r.role}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <div className="size-8 rounded-md bg-background border grid place-items-center">
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{r.title}</div>
                    <div className="text-[11px] text-muted-foreground">{r.responsibility}</div>
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {r.mode} · {r.model}
                </Badge>
              </div>
              <div className="text-xs font-medium mb-1">{r.output.headline}</div>
              <ul className="text-xs space-y-1 mb-2">
                {r.output.bullets.map((b, i) => (
                  <li key={i} className="leading-relaxed">
                    • {b}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="text-muted-foreground">来源</span>
                {r.inputs.map((s, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center px-2 py-0.5 rounded-full bg-background border text-foreground/80"
                  >
                    {provenanceLabel(s)}
                  </span>
                ))}
              </div>
              {r.notes && r.notes.length > 0 && (
                <div className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">
                  待修复：{r.notes.join("；")}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
