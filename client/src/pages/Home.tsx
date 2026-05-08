import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { api, type ProjectListItem } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AgentModeBar } from "@/components/AgentMode";
import { Plus, FolderOpen, Trash2, Upload, Compass } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Home() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: projects = [], isLoading } = useQuery<ProjectListItem[]>({
    queryKey: ["/api/projects"],
    queryFn: api.listProjects,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [idea, setIdea] = useState("");

  const createMut = useMutation({
    mutationFn: api.createProject,
    onSuccess: (proj) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setCreateOpen(false);
      setName("");
      setIdea("");
      setLocation(`/project/${proj.id}/boundary`);
    },
    onError: (e: any) => toast({ title: "创建失败", description: String(e?.message), variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/projects"] }),
  });

  const importSnap = async (file: File) => {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const p = await api.importSnapshot(json);
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "导入成功", description: p.name });
      setLocation(`/project/${p.id}/boundary`);
    } catch (e: any) {
      toast({ title: "导入失败", description: String(e?.message || e), variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-md bg-primary text-primary-foreground grid place-items-center font-bold">
              <Compass className="size-5" />
            </div>
            <div>
              <div className="font-semibold tracking-tight" data-testid="text-app-title">Builder Demo Coach</div>
              <div className="text-xs text-muted-foreground">48 小时 AI 产品教练 · 把一句话想法收敛成可提交的 Demo</div>
            </div>
          </div>
          <div className="hidden md:block w-1/2">
            <AgentModeBar context="step" />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        {/* Hero */}
        <section className="mb-10">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-2">
            把模糊想法收敛成可演示、可提交的 48 小时 Demo
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Step 0 边界 + 6 步 3+1 chip 化问答 + 三卡输出（PRD / README / Tasks）+ 小红书 Builder Test 提交说明。
            Mock 默认可用，状态条诚实告知 Mock/Real 来源。
          </p>
          <div className="md:hidden mt-4">
            <AgentModeBar context="step" />
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-create-project">
                  <Plus className="mr-1.5 size-4" />
                  创建项目
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>创建新项目</DialogTitle>
                  <DialogDescription>给你的 48 小时 Demo 起个名字，再写一句话想法。</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium">项目名</label>
                    <Input
                      placeholder="例：读书笔记 AI"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      data-testid="input-project-name"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">一句话想法</label>
                    <Textarea
                      placeholder="例：帮我整理读书笔记，自动总结关键论点"
                      value={idea}
                      onChange={(e) => setIdea(e.target.value)}
                      rows={3}
                      data-testid="input-project-idea"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setCreateOpen(false)}>取消</Button>
                  <Button
                    onClick={() => createMut.mutate({ name: name.trim(), initialIdea: idea.trim() })}
                    disabled={!name.trim() || !idea.trim() || createMut.isPending}
                    data-testid="button-create-submit"
                  >
                    {createMut.isPending ? "创建中…" : "创建并开始"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <label className="inline-flex">
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importSnap(f);
                  e.target.value = "";
                }}
                data-testid="input-import-snapshot"
              />
              <Button asChild variant="outline">
                <span>
                  <Upload className="mr-1.5 size-4" />
                  导入 Snapshot JSON
                </span>
              </Button>
            </label>
          </div>
        </section>

        {/* Project list */}
        <section>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <FolderOpen className="size-4 text-muted-foreground" /> 我的项目
          </h2>
          {isLoading ? (
            <div className="text-muted-foreground">载入中…</div>
          ) : projects.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center text-muted-foreground">
                还没有项目。点击「创建项目」开始你的 48 小时 Demo。
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <Card key={p.id} className="hover-elevate" data-testid={`card-project-${p.id}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{p.name}</CardTitle>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMut.mutate(p.id)}
                        data-testid={`button-delete-${p.id}`}
                      >
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    </div>
                    <CardDescription className="line-clamp-2">{p.initialIdea}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-xs text-muted-foreground line-clamp-2">
                      {p.ideaSummary || "（暂未生成 AI 摘要）"}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {p.boundaryConfirmed ? (
                        <Badge variant="secondary">边界已确认</Badge>
                      ) : (
                        <Badge variant="outline" className="border-amber-400/60 text-amber-700 dark:text-amber-300">
                          边界待确认
                        </Badge>
                      )}
                      <Link href={`/project/${p.id}/${p.boundaryConfirmed ? "discovery" : "boundary"}`}>
                        <Button variant="outline" size="sm" data-testid={`button-open-${p.id}`}>
                          打开
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>
      <footer className="max-w-6xl mx-auto px-6 py-8 text-xs text-muted-foreground">
        服务端 SQLite + Snapshot JSON 共同保证「不依赖浏览器存储」的持久化。
      </footer>
    </div>
  );
}
