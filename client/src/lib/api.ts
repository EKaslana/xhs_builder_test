import { apiRequest } from "./queryClient";
import type { HydratedProject, StepId } from "@shared/schema";

export type AgentMode = {
  mode: "mock" | "real" | "real-pending";
  auxMode: "mock" | "real" | "real-pending";
  provider: string;
  model: string;
  baseUrl: string;
  consumesApi: boolean;
  reproducible: boolean;
  temperature: number | null;
  seed: number | null;
  realCapable: boolean;
  lastStepCallSucceeded: boolean;
  lastCallAt?: number | null;
  lastError?: string | null;
};

export type SubagentReport = {
  role:
    | "problem_discovery"
    | "boundary_coach"
    | "prd"
    | "build_planner"
    | "pitch"
    | "validation";
  title: string;
  responsibility: string;
  inputs: string[];
  mode: "mock" | "real";
  provider: string;
  model: string;
  output: { headline: string; bullets: string[]; markdown: string };
  notes?: string[];
};

export type XHSFields = {
  demoName: string;
  demoLink: string;
  demoDescription: string;
  whyThisSolution: string;
  implementationDetails: string;
  learnings: string;
};

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
  demoLinkOk: boolean;
};

export type ProjectListItem = {
  id: string;
  name: string;
  initialIdea: string;
  ideaSummary: string;
  boundaryConfirmed: boolean;
  createdAt: number;
  updatedAt: number;
};

export const api = {
  agentMode: async (): Promise<AgentMode> =>
    (await apiRequest("GET", "/api/meta/agent-mode")).json(),
  listProjects: async (): Promise<ProjectListItem[]> =>
    (await apiRequest("GET", "/api/projects")).json(),
  getProject: async (id: string): Promise<HydratedProject> =>
    (await apiRequest("GET", `/api/projects/${id}`)).json(),
  createProject: async (input: { name: string; initialIdea: string }) =>
    (await apiRequest("POST", "/api/projects", input)).json() as Promise<HydratedProject>,
  deleteProject: async (id: string) =>
    (await apiRequest("DELETE", `/api/projects/${id}`)).json(),
  patchProject: async (id: string, body: any) =>
    (await apiRequest("PATCH", `/api/projects/${id}`, body)).json() as Promise<HydratedProject>,
  boundaryOptions: async (id: string) =>
    (await apiRequest("GET", `/api/projects/${id}/boundary/options`)).json(),
  boundaryDraft: async (id: string, body: any) =>
    (await apiRequest("POST", `/api/projects/${id}/boundary/draft`, body)).json() as Promise<HydratedProject>,
  boundaryConfirm: async (id: string, body: any) =>
    (await apiRequest("POST", `/api/projects/${id}/boundary/confirm`, body)).json() as Promise<HydratedProject>,
  qaNext: async (id: string, stepId: StepId) =>
    (await apiRequest("GET", `/api/projects/${id}/qa/${stepId}/next`)).json(),
  qaAnswer: async (id: string, stepId: StepId, body: any) =>
    (await apiRequest("POST", `/api/projects/${id}/qa/${stepId}/answer`, body)).json(),
  qaResolve: async (id: string, stepId: StepId, body: any) =>
    (await apiRequest("POST", `/api/projects/${id}/qa/${stepId}/resolve-conflict`, body)).json(),
  qaReset: async (id: string, stepId: StepId) =>
    (await apiRequest("POST", `/api/projects/${id}/qa/${stepId}/reset`)).json(),
  patchStep: async (id: string, stepId: StepId, body: any) =>
    (await apiRequest("PATCH", `/api/projects/${id}/step/${stepId}`, body)).json() as Promise<HydratedProject>,
  lockStep: async (id: string, stepId: StepId, locked: boolean) =>
    (await apiRequest("POST", `/api/projects/${id}/step/${stepId}/lock`, { locked })).json() as Promise<HydratedProject>,
  generate: async (projectId: string, stepId: StepId) =>
    (await apiRequest("POST", "/api/generate", { projectId, stepId })).json(),
  exports: async (id: string, publicLink?: string): Promise<ExportsResponse> => {
    const q = publicLink ? `?publicLink=${encodeURIComponent(publicLink)}` : "";
    return (await apiRequest("GET", `/api/projects/${id}/exports${q}`)).json();
  },
  orchestrator: async (id: string, publicLink?: string) => {
    const q = publicLink ? `?publicLink=${encodeURIComponent(publicLink)}` : "";
    return (await apiRequest("GET", `/api/projects/${id}/orchestrator${q}`)).json() as Promise<{
      reports: SubagentReport[];
      readiness: ExportsResponse["readiness"];
      demoLinkOk: boolean;
    }>;
  },
  snapshot: async (id: string) =>
    (await apiRequest("GET", `/api/projects/${id}/snapshot`)).json(),
  importSnapshot: async (snap: any) =>
    (await apiRequest("POST", `/api/projects/import`, snap)).json() as Promise<HydratedProject>,
};
