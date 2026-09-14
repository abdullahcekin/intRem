export type SessionState = 'idle' | 'working' | 'waiting_answer' | 'permission_required' | 'offline' | 'delivery_unknown';
export type MessageState = 'queued' | 'delivering' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'delivery_unknown';
export type SessionSource = 'managed' | 'imported';
export interface Project {
  id: string; name: string; cwd: string; host: string; createdAt: string;
  mode: 'default' | 'plan'; dailyBudgetUsd: number; pushEnabled: boolean;
}
export interface Session {
  id: string; projectId: string; title: string; source: SessionSource;
  state: SessionState; generation: string; claudeSessionId: string | null;
  sourcePid: number | null; sourceStart: string | null; tmuxPane: string | null;
  requestedModel: string | null; actualModel: string | null; account: string | null;
  fallbackReason: string | null; controlEnabled: boolean;
  createdAt: string; updatedAt: string; lastActivityAt: string | null;
}
export interface Message {
  id: string; sessionId: string; clientId: string | null; role: 'user' | 'assistant' | 'system';
  text: string; state: MessageState; createdAt: string; updatedAt: string; error: string | null;
}
export interface Question { question: string; header?: string; options: { label: string; description?: string }[]; multiSelect?: boolean }
export interface Interaction {
  id: string; sessionId: string; generation: string; requestId: string; contentHash: string;
  kind: 'permission' | 'question' | 'plan'; toolName: string; input: Record<string, unknown>;
  status: 'pending' | 'answered' | 'expired' | 'cancelled'; createdAt: string; expiresAt: string;
  decision: DecisionInput | null; decidedBy: string | null; appliedAt: string | null;
}
export interface DecisionInput { behavior: 'allow' | 'deny'; answers?: Record<string, string>; reason?: string }
export interface AppEvent { id: number; type: string; sessionId: string | null; data: Record<string, unknown>; createdAt: string }
export interface Device { id: string; name: string; createdAt: string; lastSeenAt: string; revokedAt: string | null; pushEnabled: boolean }
export interface DiscoveredSession {
  claudeSessionId: string; pid: number; processStart: string; cwd: string; title: string;
  version: string | null; tmuxPane: string | null; active: boolean;
}
export interface AppSnapshot {
  projects: Project[]; sessions: Session[]; interactions: Interaction[]; cursor: number;
  remoteControlEnabled: boolean;
}
export interface Review {
  id: string; sessionId: string; generation: string; clientId: string;
  status: 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'stale' | 'interrupted' | 'cancelled';
  createdAt: string; updatedAt: string; output: string; revision: string | null; exitCode: number | null;
}
export interface OmniRouteCount {
  state: 'ok' | 'auth_required' | 'unavailable' | 'not_configured';
  count: number | null;
}
export interface OmniRouteSetup {
  checkedAt: string;
  connections: OmniRouteCount;
  pools: OmniRouteCount;
}
export interface HealthReport {
  bridge: { ok: boolean; version: string };
  runner: { ok: boolean; lastSeenAt: string | null };
  claude: { ok: boolean; version: string | null };
  omniroute: { ok: boolean; url: string | null; detail: string; setup: OmniRouteSetup };
  codex: { ok: boolean; version: string | null };
}
