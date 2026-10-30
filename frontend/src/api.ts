let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export async function api(path: string, body?: unknown, method?: string) {
  const r = await fetch("/api" + path, {
    method: method || (body !== undefined ? "POST" : "GET"),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let m = "Agent request failed";
    try {
      m = (await r.json()).detail || m;
    } catch {}
    if (r.status === 401) window.dispatchEvent(new Event("auth-lost"));
    throw new Error(typeof m === "string" ? m : JSON.stringify(m));
  }
  return r.json();
}
export type Connection = {
  id: string;
  type: "ssh" | "uart";
  host?: string;
  port?: number;
  username?: string;
  auth?: string;
  password?: string;
  password_saved?: boolean;
  key_ref?: string;
  key_passphrase?: string;
  device?: string;
  baud?: number;
  login_username?: string;
  login_password?: string;
  login_password_saved?: boolean;
  advanced?: Record<string, unknown>;
};
export type Board = {
  id: string;
  name: string;
  target: string;
  connections: Connection[];
  metadata: Record<string, string>;
  overrides: Record<string, unknown>;
  verification: { connections: Verification[] };
};
export type Verification = {
  type: string;
  state: string;
  error?: string;
  verified_at?: number;
  trust?: { fingerprint: string; host: string; port: number; changed: boolean };
};
export type Run = {
  id: string;
  board_id: string;
  name: string;
  state: string;
  created: number;
  started?: number;
  finished?: number;
  step: string;
  transport?: string;
  timeout: number;
  error?: string;
  plan: { definition: Definition; parameters: Record<string, string> }[];
  settings: Record<string, unknown>;
};
export type Definition = {
  id: string;
  name: string;
  purpose: string;
  parameters: Record<string, string>;
  prerequisites: string[];
  capabilities: string[];
  resources: string[];
  timeout: number;
  steps: string[];
  checks: string;
  cleanup: string;
};
export type Suite = {
  id: string;
  name: string;
  stages: { test: string; parameters: Record<string, string> }[];
};
export type State = {
  boards: Board[];
  active: Run[];
  recent: Run[];
  catalog: Definition[];
  suites: Suite[];
  counts: {
    reachable: number;
    running: number;
    queued: number;
    passed: number;
    failed: number;
  };
  defaults: Record<string, unknown>;
  timezone: string;
  ai_configured: boolean;
  alerts: string[];
};
export type Log = {
  id: number;
  board_id: string;
  run_id?: string;
  source: string;
  timestamp: number;
  raw: string;
};
export function clean(s: string) {
  return s
    .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|$))/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}
