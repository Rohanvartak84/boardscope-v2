import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  Cpu,
  House,
  PanelsTopLeft,
  ClipboardList,
  FileChartColumn,
  Sparkles,
  Settings,
  Plus,
  Play,
  Search,
  MoreVertical,
  Terminal,
  Activity,
  Check,
  X,
  Pause,
  Copy,
  Download,
  Send,
  ChevronRight,
  Radio,
  Network,
  RefreshCw,
  LogOut,
  Trash2,
  Info,
  Clock,
  Square,
  ArrowLeft,
  Link,
  ExternalLink,
} from "lucide-react";
import {
  api,
  setCsrf,
  clean,
  type Board,
  type State,
  type Run,
  type Connection,
  type Verification,
  type Suite,
  type Log,
} from "./api";
import "./style.css";
const NAV = [
  ["Overview", House],
  ["Boards", PanelsTopLeft],
  ["Tests", ClipboardList],
  ["Results", FileChartColumn],
  ["Assistant", Sparkles],
  ["Settings", Settings],
] as const;
const label = (v: string) => v.replaceAll("_", " ");
const elapsed = (r: Run, now = Date.now() / 1000) => {
  const n = Math.max(
    0,
    Math.floor((r.finished || now) - (r.started || r.created)),
  );
  return `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${(n % 60).toString().padStart(2, "0")}`;
};
const date = (v: number, tz?: string) =>
  new Date(v * 1000).toLocaleString(undefined, { timeZone: tz });
function Badge({ state }: { state: string }) {
  return (
    <span className={"badge " + state}>
      <i />
      {label(state)}
    </span>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const el = ref.current!;
    el.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const f = Array.from(
          el.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input, select, textarea, [tabindex="0"]',
          ),
        );
        const first = f[0],
          last = f[f.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === el)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      old?.focus();
    };
  }, []);
  return (
    <div className="scrim">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={"modal " + (wide ? "wide" : "")}
      >
        <header>
          <div>
            <span className="eyebrow">LOCAL WORKSPACE</span>
            <h2>{title}</h2>
          </div>
          <button aria-label="Close dialog" className="icon" onClick={onClose}>
            <X size={21} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
function App() {
  const [auth, setAuth] = useState<boolean | null>(null),
    [setup, setSetup] = useState(false),
    [password, setPassword] = useState(""),
    [error, setError] = useState("");
  const [state, setState] = useState<State | null>(null),
    [page, setPage] = useState("Overview"),
    [selected, setSelected] = useState(""),
    [selectedRuns, setSelectedRuns] = useState<Record<string, string>>({}),
    [selectedHistory, setSelectedHistory] = useState<Run | null>(null),
    [modal, setModal] = useState(""),
    [editBoard, setEditBoard] = useState<Board | undefined>(),
    [target, setTarget] = useState<Board | undefined>(),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [agent, setAgent] = useState(false),
    [tab, setTab] = useState("workspace"),
    [tick, setTick] = useState(0);
  const refresh = useCallback(async () => {
    try {
      setState(await api("/state"));
      setAgent(true);
    } catch (e) {
      setAgent(false);
      throw e;
    }
  }, []);
  useEffect(() => {
    api("/auth-status")
      .then((a) => {
        setAuth(a.authenticated);
        setSetup(a.setup_required);
        if (a.csrf) setCsrf(a.csrf);
      })
      .catch((e) => setError(e.message));
    const lost = () => setAuth(false);
    window.addEventListener("auth-lost", lost);
    return () => window.removeEventListener("auth-lost", lost);
  }, []);
  useEffect(() => {
    if (!auth) return;
    refresh().catch((e) => setError(e.message));
    const t = setInterval(() => refresh().catch(() => {}), 2000),
      clock = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      clearInterval(t);
      clearInterval(clock);
    };
  }, [auth, refresh]);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      setError("");
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const board = state?.boards.find((b) => b.id === selected),
    run =
      selectedHistory?.board_id === selected
        ? selectedHistory
        : state?.active.find((r) => r.id === selectedRuns[selected]);
  function choose(b: Board, r?: Run) {
    setSelected(b.id);
    setSelectedHistory(r && r.finished ? r : null);
    if (r) setSelectedRuns((s) => ({ ...s, [b.id]: r.id }));
  }
  function action(b: Board, name: string) {
    setTarget(b);
    if (name === "settings") {
      setEditBoard(b);
      setModal("board");
    } else setModal(name);
  }
  if (auth === null)
    return (
      <div className="login">
        <Cpu />
        <h1>BoardScope</h1>
        <p>Connecting to local agent…</p>
        {error && <p className="error">{error}</p>}
      </div>
    );
  if (!auth)
    return (
      <div className="login">
        <div className="loginbox">
          <div className="brand">
            <Cpu size={36} />
            <div>
              BoardScope<small>Embedded Testing</small>
            </div>
          </div>
          <h1>Your lab, locally.</h1>
          <p>Sign in to your private testing workbench.</p>
          {setup ? (
            <div className="note">
              Create the local account in the agent terminal:
              <code>
                cd backend
                <br />
                ../.venv/bin/python -m boardscope setup
              </code>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                api("/login", { password })
                  .then((a) => {
                    setCsrf(a.csrf);
                    setPassword("");
                    setAuth(true);
                    setError("");
                  })
                  .catch((e) => setError(e.message));
              }}
            >
              <label>
                Local password
                <input
                  autoFocus
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
              <button className="primary full">
                Unlock workspace <ChevronRight size={17} />
              </button>
            </form>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <small className="muted">
            <Link size={12} /> Served by your local BoardScope agent
          </small>
        </div>
      </div>
    );
  if (!state)
    return (
      <div className="login">
        <h1>Starting local workspace…</h1>
        {error && <p className="error">{error}</p>}
      </div>
    );
  const visible = state.boards
    .filter((b) =>
      [b.name, ...b.connections.map((c) => c.host || c.device)]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .filter(
      (b) =>
        filter === "all" ||
        (filter === "active" &&
          state.active.some((r) => r.board_id === b.id)) ||
        (filter === "ssh" && b.connections.some((c) => c.type === "ssh")) ||
        (filter === "uart" && b.connections.some((c) => c.type === "uart")) ||
        (filter === "unverified" &&
          !b.verification?.connections.some(
            (c) => c.verified_at && Date.now() / 1000 - c.verified_at < 120,
          )),
    );
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <Cpu size={34} />
          <div>
            BoardScope<small>Embedded Testing</small>
          </div>
        </div>
        <nav>
          {NAV.map(([name, Icon]) => (
            <button
              key={name}
              aria-label={name}
              aria-current={page === name ? "page" : undefined}
              className={page === name ? "current" : ""}
              onClick={() => setPage(name)}
            >
              <Icon size={20} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
        <div
          className="agent"
          role="status"
          aria-label={
            agent ? "Local agent connected" : "Local agent disconnected"
          }
        >
          <Radio size={18} />
          <div>
            Local agent
            <strong className={agent ? "green" : "red"}>
              {agent ? "Connected" : "Disconnected"}
            </strong>
          </div>
        </div>
        <button
          className="logout"
          onClick={() =>
            act(async () => {
              await api("/logout", {});
              setAuth(false);
            })
          }
        >
          <LogOut size={14} /> Lock workspace
        </button>
        <small className="version">v0.1.0 · Local only</small>
      </aside>
      <header className="topbar">
        <div>
          <h1>{page}</h1>
          <span className="localtag">LOCAL WORKSPACE</span>
        </div>
        <div className="actions">
          <button
            className="primary"
            onClick={() => {
              setEditBoard(undefined);
              setModal("board");
            }}
          >
            <Plus size={17} /> Add Board
          </button>
          <button
            disabled={!state.boards.length}
            onClick={() => {
              setTarget(board);
              setModal("run");
            }}
          >
            <Play size={16} /> Run Test
          </button>
        </div>
      </header>
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      <div className="mobile-tabs" role="tablist" aria-label="Overview panels">
        {["workspace", "logs", "assistant"].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            aria-controls={t + "-panel"}
            tabIndex={tab === t ? 0 : -1}
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const tabs = ["workspace", "logs", "assistant"];
                const n =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? 2
                      : (tabs.indexOf(t) + (e.key === "ArrowRight" ? 1 : 2)) %
                        3;
                setTab(tabs[n]);
                (
                  e.currentTarget.parentElement?.querySelectorAll("[role=tab]")[
                    n
                  ] as HTMLElement
                )?.focus();
              }
            }}
            className={tab === t ? "current" : ""}
            onClick={() => setTab(t)}
          >
            {label(t)}
          </button>
        ))}
      </div>
      <main
        id="workspace-panel"
        role="tabpanel"
        aria-label="Workspace"
        className={"workspace " + (tab === "workspace" ? "mobile-visible" : "")}
      >
        {page !== "Overview" ? (
          <div className="placeholder">
            <div className="empty-icon">
              <ClipboardList size={32} />
            </div>
            <span className="eyebrow">COMING IN A LATER PHASE</span>
            <h2>{page}</h2>
            <p>Detailed {page.toLowerCase()} functionality is planned.</p>
            <p>
              Use Overview to manage boards, run tests, and inspect evidence.
            </p>
            <button onClick={() => setPage("Overview")}>
              <ArrowLeft size={16} /> Back to Overview
            </button>
          </div>
        ) : (
          <>
            <div className="stats">
              {[
                ["Boards reachable", state.counts.reachable, Cpu, "blue"],
                ["Tests running", state.counts.running, Play, "amber"],
                ["Passed today", state.counts.passed, Check, "green"],
                ["Failed today", state.counts.failed, X, "red"],
              ].map(([name, n, Icon, color]) => {
                const I = Icon as typeof Cpu;
                return (
                  <div className="stat" key={String(name)}>
                    <div className={"stat-icon " + color}>
                      <I size={25} />
                    </div>
                    <div>
                      <strong>{String(n)}</strong>
                      <span>{String(name)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {state.alerts?.map((message, i) => (
              <div className="note error" role="alert" key={i}>
                <Info size={17} />
                {message}
              </div>
            ))}
            <div className="summary-note">
              Reachability expires after 2 minutes · {state.counts.queued}{" "}
              queued · Today in {state.timezone}
            </div>
            <section>
              <div className="section-head">
                <h2>
                  Boards <span>({state.boards.length})</span>
                </h2>
                <div className="filters">
                  <div className="search">
                    <Search size={15} />
                    <input
                      aria-label="Search boards"
                      placeholder="Search boards…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <select
                    aria-label="Filter boards"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">All connections</option>
                    <option value="ssh">Has SSH</option>
                    <option value="uart">Has UART</option>
                    <option value="active">Active work</option>
                    <option value="unverified">Stale / not verified</option>
                  </select>
                </div>
              </div>
              {!state.boards.length ? (
                <div className="empty board-empty">
                  <div className="empty-icon">
                    <Cpu size={35} />
                  </div>
                  <h3>Bring your first board online</h3>
                  <p>
                    Add a Linux board with SSH, Serial / UART, or both.
                    <br />
                    Connections and test evidence stay on your machine.
                  </p>
                  <button
                    className="primary"
                    onClick={() => {
                      setEditBoard(undefined);
                      setModal("board");
                    }}
                  >
                    <Plus size={16} /> Add your first board
                  </button>
                  <small>No boards configured. No tests have been run.</small>
                </div>
              ) : !visible.length ? (
                <div className="empty">
                  <p>No boards match these filters.</p>
                </div>
              ) : (
                <div className="board-grid">
                  {visible.map((b) => {
                    const active = state.active.filter(
                        (r) => r.board_id === b.id,
                      ),
                      r = active.find((r) => r.id === selectedRuns[b.id]);
                    const address =
                      b.connections.find((c) => c.type === "ssh")?.host ||
                      b.connections.find((c) => c.type === "uart")?.device;
                    return (
                      <article
                        key={b.id}
                        className={
                          "board-card " + (selected === b.id ? "selected" : "")
                        }
                        onClick={() => choose(b)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (
                            e.target === e.currentTarget &&
                            (e.key === "Enter" || e.key === " ")
                          ) {
                            e.preventDefault();
                            choose(b);
                          }
                        }}
                        aria-label={`Select ${b.name}`}
                      >
                        <div className="card-head">
                          <h3>{b.name}</h3>
                          <span className="tag">Linux</span>
                          <BoardMenu
                            b={b}
                            state={state}
                            action={action}
                            act={act}
                            choose={choose}
                          />
                        </div>
                        <p className="os">
                          {b.metadata?.os || "OS not detected"} <span>│</span>{" "}
                          {b.metadata?.kernel
                            ? "Linux " + b.metadata.kernel
                            : "Kernel unknown"}
                        </p>
                        <div className="address">
                          <Network size={13} />
                          {address}
                        </div>
                        <div className="connection-states">
                          {b.connections.map((c) => {
                            const v = b.verification?.connections.find(
                              (v) => v.type === c.type,
                            );
                            const current =
                              v?.verified_at &&
                              Date.now() / 1000 - v.verified_at < 120;
                            return (
                              <div key={c.id}>
                                <i
                                  className={
                                    "dot " +
                                    (current
                                      ? "green"
                                      : v?.verified_at
                                        ? "amber"
                                        : "neutral")
                                  }
                                />
                                <span>{c.type.toUpperCase()}</span>
                                <span className={current ? "green" : "muted"}>
                                  {current
                                    ? "Shell verified"
                                    : v?.verified_at
                                      ? "Stale"
                                      : v?.state
                                        ? label(v.state)
                                        : "Not verified"}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <select
                          aria-label={`Selected test for ${b.name}`}
                          value={r?.id || ""}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            setSelectedHistory(null);
                            setSelected(b.id);
                            setSelectedRuns((s) => ({
                              ...s,
                              [b.id]: e.target.value,
                            }));
                          }}
                        >
                          <option value="">
                            {active.length
                              ? "Select an active test"
                              : "No active tests"}
                          </option>
                          {active.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name} · {label(r.state)}
                            </option>
                          ))}
                        </select>
                        <div className="card-foot">
                          {r ? (
                            <>
                              <Badge state={r.state} />
                              <span>{elapsed(r)}</span>
                            </>
                          ) : (
                            <span className="muted">
                              {active.length
                                ? "Work active"
                                : "Idle · ready to configure"}
                            </span>
                          )}
                          <small>
                            {active.filter((r) => r.state !== "queued").length}{" "}
                            running ·{" "}
                            {active.filter((r) => r.state === "queued").length}{" "}
                            queued
                          </small>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
            <section>
              <div className="section-head">
                <h2>
                  Running Tests{" "}
                  <span>
                    ({state.active.filter((r) => r.state !== "queued").length})
                  </span>
                </h2>
                <button className="subtle" onClick={() => setModal("suites")}>
                  <ClipboardList size={15} /> Manage suites
                </button>
              </div>
              <RunTable
                runs={state.active}
                state={state}
                choose={(r) => {
                  const b = state.boards.find((b) => b.id === r.board_id);
                  if (b) choose(b, r);
                  setTab("logs");
                }}
                stop={(id) => act(() => api(`/runs/${id}/stop`, {}))}
              />
            </section>
            <section>
              <div className="section-head">
                <h2>Recent Results</h2>
                <button
                  className="subtle"
                  onClick={() => {
                    setTarget(undefined);
                    setModal("history");
                  }}
                >
                  View history <ChevronRight size={15} />
                </button>
              </div>
              <ResultsTable
                runs={state.recent}
                state={state}
                onLogs={(r) => {
                  setSelected(r.board_id);
                  setSelectedHistory(r);
                  setTab("logs");
                }}
              />
            </section>
            <footer className="workspace-footer">
              <span>
                <i className="dot green" /> Evidence stored locally
              </span>
              <span>AI is optional. Test outcomes are deterministic.</span>
            </footer>
          </>
        )}
      </main>
      <aside
        className={
          "right-column " + (tab !== "workspace" ? "mobile-visible" : "")
        }
      >
        <div
          className={
            "log-container " + (tab === "assistant" ? "mobile-hidden" : "")
          }
        >
          <Logs
            board={board}
            run={run}
            state={state}
            choose={(bid, rid) => {
              setSelected(bid);
              setSelectedHistory(null);
              setSelectedRuns((s) => ({ ...s, [bid]: rid }));
            }}
          />
        </div>
        <div
          className={
            "assistant-container " + (tab === "logs" ? "mobile-hidden" : "")
          }
        >
          <Assistant board={board} run={run} configured={state.ai_configured} />
        </div>
      </aside>
      {modal === "board" && (
        <BoardDialog
          board={editBoard}
          state={state}
          close={() => setModal("")}
          saved={() => {
            setModal("");
            refresh();
          }}
        />
      )}
      {modal === "run" && (
        <RunDialog
          state={state}
          board={target}
          close={() => setModal("")}
          started={(id) => {
            setModal("");
            refresh();
            if (target) setSelectedRuns((s) => ({ ...s, [target.id]: id }));
          }}
        />
      )}
      {modal === "suites" && (
        <SuiteDialog
          state={state}
          close={() => setModal("")}
          saved={() => refresh()}
        />
      )}
      {modal === "history" && (
        <History
          state={state}
          board={target}
          close={() => setModal("")}
          onLogs={(r) => {
            setSelected(r.board_id);
            setSelectedHistory(r);
            setModal("");
            setTab("logs");
          }}
        />
      )}
      {modal === "plan" && target && (
        <Modal
          title={`${target.name} · Test plan`}
          onClose={() => setModal("")}
        >
          <div className="modal-body">
            {state.active
              .filter((r) => r.board_id === target.id)
              .map((r) => (
                <div className="plan" key={r.id}>
                  <h3>
                    {r.name} <Badge state={r.state} />
                  </h3>
                  <p>{r.step}</p>
                  {r.plan.map((p, i) => (
                    <div key={i}>
                      <strong>
                        Stage {i + 1} · {p.definition.name}
                      </strong>
                      <ol>
                        {p.definition.steps.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              ))}
            {!state.active.some((r) => r.board_id === target.id) && (
              <div className="plan">
                <h3>Saved default plan · not started</h3>
                {state.suites
                  .find(
                    (s) =>
                      s.id ===
                      (target.overrides.default_suite ||
                        state.defaults.default_suite),
                  )
                  ?.stages.map((stage, i) => (
                    <div key={i}>
                      <strong>
                        Stage {i + 1} ·{" "}
                        {state.catalog.find((t) => t.id === stage.test)?.name}
                      </strong>
                      <ol>
                        {state.catalog
                          .find((t) => t.id === stage.test)
                          ?.steps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                      </ol>
                    </div>
                  )) || (
                  <p>
                    No default suite assigned. Create a suite, then assign it in
                    Board settings.
                  </p>
                )}
              </div>
            )}
            <button onClick={() => setModal("suites")}>Manage suites</button>
          </div>
        </Modal>
      )}
      {modal === "console" && target && (
        <Console board={target} close={() => setModal("")} />
      )}
      {["reboot", "stop", "remove", "suite"].includes(modal) && target && (
        <Confirm
          kind={modal}
          board={target}
          state={state}
          close={() => setModal("")}
          execute={async (body) => {
            await act(async () => {
              if (modal === "remove")
                await api(`/boards/${target.id}`, body, "DELETE");
              if (modal === "stop") await api(`/boards/${target.id}/stop`, {});
              if (modal === "reboot")
                await api("/runs", {
                  board_id: target.id,
                  items: [{ test: "reboot", parameters: {}, confirmed: true }],
                });
              if (modal === "suite")
                await api("/runs", {
                  board_id: target.id,
                  suite_id:
                    target.overrides.default_suite ||
                    state.defaults.default_suite,
                  confirmed: true,
                });
              setModal("");
            });
          }}
        />
      )}
    </div>
  );
}
function BoardMenu({
  b,
  state,
  action,
  act,
  choose,
}: {
  b: Board;
  state: State;
  action: (b: Board, n: string) => void;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  choose: (b: Board) => void;
}) {
  const [open, setOpen] = useState(false),
    ref = useRef<HTMLDivElement>(null);
  const busy = state.active.some((r) => r.board_id === b.id),
    suite = b.overrides.default_suite || state.defaults.default_suite;
  useEffect(() => {
    if (!open) return;
    function out(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", out);
    return () => document.removeEventListener("click", out);
  }, [open]);
  const items = [
    ["Start configured suite", "suite", !suite || busy],
    ["View test plan", "plan", false],
    ["Verify connections", "verify", busy],
    ["Open console", "console", busy],
    ["View last results", "history", false],
    ["Board settings", "settings", busy],
    ["Reboot board…", "reboot", busy],
    ["Stop active tests…", "stop", !busy],
    ["Remove board…", "remove", busy],
  ] as const;
  return (
    <div
      className="menu-wrap"
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        className="icon"
        aria-label={`Actions for ${b.name}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreVertical size={18} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map(([name, key, disabled], i) => (
            <React.Fragment key={key}>
              {[2, 6, 8].includes(i) && <hr />}
              <button
                role="menuitem"
                disabled={disabled}
                title={
                  disabled
                    ? "Unavailable while busy or no default suite assigned"
                    : undefined
                }
                className={["remove", "stop"].includes(key) ? "danger" : ""}
                onClick={() => {
                  setOpen(false);
                  if (key === "verify") {
                    choose(b);
                    act(async () => {
                      const v = await api(`/boards/${b.id}/verify`, {});
                      if (
                        v.connections.some(
                          (c: Verification) => c.state === "trust_required",
                        )
                      )
                        action(b, "settings");
                      else if (v.connections.some((c: Verification) => c.error))
                        throw new Error(
                          v.connections
                            .map((c: Verification) => c.error)
                            .filter(Boolean)
                            .join("; "),
                        );
                    });
                  } else action(b, key);
                }}
              >
                {name}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
function RunTable({
  runs,
  state,
  choose,
  stop,
}: {
  runs: Run[];
  state: State;
  choose: (r: Run) => void;
  stop: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {[
              "Board / Test",
              "Stage & transport",
              "State",
              "Elapsed / timeout",
              "Actions",
            ].map((x) => (
              <th key={x}>{x}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>
                  {state.boards.find((b) => b.id === r.board_id)?.name ||
                    r.board_id.slice(0, 8)}
                </strong>
                <small>{r.name}</small>
              </td>
              <td>
                {r.step}
                <small>{r.transport || "Waiting for worker"}</small>
              </td>
              <td>
                <Badge state={r.state} />
              </td>
              <td>
                {elapsed(r)}
                <small>{r.timeout}s limit</small>
              </td>
              <td>
                <div className="actions">
                  <button onClick={() => choose(r)}>View Logs</button>
                  <button
                    className="icon"
                    aria-label={`Stop ${r.name}`}
                    onClick={() => stop(r.id)}
                    disabled={r.state === "cancelling"}
                  >
                    <Square size={13} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {!runs.length && (
            <tr>
              <td colSpan={5} className="table-empty">
                <Activity size={17} /> No tests running or queued. Start a test
                when your board is ready.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function ResultsTable({
  runs,
  state,
  onLogs,
}: {
  runs: Run[];
  state: State;
  onLogs: (r: Run) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {["Board / Test", "Result", "Duration", "Finished", "Evidence"].map(
              (x) => (
                <th key={x}>{x}</th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>
                  {state.boards.find((b) => b.id === r.board_id)?.name ||
                    "Removed board"}
                </strong>
                <small>{r.name}</small>
              </td>
              <td>
                <Badge state={r.state} />
                {r.error && (
                  <small className="error" title={r.error}>
                    {r.error.slice(0, 110)}
                  </small>
                )}
              </td>
              <td>{elapsed(r)}</td>
              <td>{r.finished ? date(r.finished, state.timezone) : "—"}</td>
              <td>
                <div className="actions">
                  <button onClick={() => onLogs(r)}>Logs</button>
                  <a
                    className="button"
                    href={`/api/runs/${r.id}/report`}
                    download
                  >
                    Report <Download size={12} />
                  </a>
                </div>
              </td>
            </tr>
          ))}
          {!runs.length && (
            <tr>
              <td colSpan={5} className="table-empty">
                No completed runs yet. Results and their evidence will appear
                here.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function BoardDialog({
  board,
  state,
  close,
  saved,
}: {
  board?: Board;
  state: State;
  close: () => void;
  saved: () => void;
}) {
  const [name, setName] = useState(board?.name || ""),
    [connections, setConnections] = useState<Connection[]>(
      board?.connections || [],
    ),
    [overrides, setOverrides] = useState<Record<string, unknown>>(
      board?.overrides || {},
    ),
    [ports, setPorts] = useState<{ device: string; description: string }[]>([]),
    [keys, setKeys] = useState<string[]>([]),
    [adding, setAdding] = useState(false),
    [result, setResult] = useState<{
      connections: Verification[];
      receipt: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const refreshPorts = () =>
    api("/ports")
      .then(setPorts)
      .catch((e) => setError(e.message));
  useEffect(() => {
    refreshPorts();
    api("/keys")
      .then(setKeys)
      .catch((e) => setError(e.message));
  }, []);
  const payload = () => ({
    ...(board ? { id: board.id } : {}),
    name,
    target: "linux",
    connections,
    overrides,
  });
  const invalidate = () => setResult(null);
  function change(id: string, patch: Partial<Connection>) {
    invalidate();
    setConnections((cs) =>
      cs.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  }
  async function verify(approvals: Record<string, string> = {}) {
    setBusy(true);
    setError("");
    try {
      let r = await api("/verify", { ...payload(), approvals });
      setResult(r);
      for (let i = 0; i < r.connections.length; i++) {
        const v: Verification = r.connections[i];
        if (v.state === "trust_required" && v.trust) {
          if (
            window.confirm(
              `Trust this first-use SSH host key?\n\n${v.trust.host}:${v.trust.port}\n${v.trust.fingerprint}\n\nCompare this fingerprint with the board administrator through a trusted channel before accepting.`,
            )
          ) {
            r = await api("/verify", {
              ...payload(),
              approvals: { [i]: v.trust.fingerprint },
            });
            setResult(r);
          }
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function add(type: "ssh" | "uart") {
    setConnections((cs) => [
      ...cs,
      {
        id: crypto.randomUUID(),
        type,
        ...(type === "ssh"
          ? { host: "", port: 22, username: "", auth: "password" }
          : { device: ports[0]?.device || "", baud: 115200 }),
      },
    ]);
    setAdding(false);
    invalidate();
  }
  return (
    <Modal
      title={board ? `Board settings · ${board.name}` : "Add Board"}
      onClose={close}
      wide
    >
      <div className="modal-body">
        <p className="muted">
          Name your target and configure connections on the machine running the
          agent.
        </p>
        <div className="form-grid">
          <label>
            Board name
            <input
              value={name}
              maxLength={100}
              onChange={(e) => {
                setName(e.target.value);
                invalidate();
              }}
              placeholder="Board-01 — Lab"
            />
          </label>
          <label>
            Target type
            <select value="linux" onChange={() => {}}>
              <option value="linux">Linux board</option>
            </select>
          </label>
        </div>
        <div className="section-head">
          <h3>Connections</h3>
          <span className="muted">SSH first · UART recovery</span>
        </div>
        {connections.map((c) => (
          <div className="connection-editor" key={c.id}>
            <div className="section-head">
              <h3>
                {c.type === "ssh" ? (
                  <Terminal size={18} />
                ) : (
                  <Radio size={18} />
                )}{" "}
                {c.type === "ssh" ? "SSH" : "Serial / UART"}
              </h3>
              <button
                disabled={busy}
                className="icon danger"
                aria-label={`Remove ${c.type} connection`}
                onClick={() => {
                  setConnections((cs) => cs.filter((x) => x.id !== c.id));
                  invalidate();
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
            {c.type === "ssh" ? (
              <>
                <div className="form-grid">
                  <label>
                    Hostname or IP
                    <input
                      value={c.host || ""}
                      onChange={(e) => change(c.id, { host: e.target.value })}
                      placeholder="192.168.1.101"
                    />
                  </label>
                  <label>
                    Port
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={c.port}
                      onChange={(e) =>
                        change(c.id, { port: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Username
                    <input
                      autoComplete="off"
                      value={c.username || ""}
                      onChange={(e) =>
                        change(c.id, { username: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Authentication
                    <select
                      value={c.auth}
                      onChange={(e) => change(c.id, { auth: e.target.value })}
                    >
                      <option value="password">Password</option>
                      <option value="key">SSH key</option>
                    </select>
                  </label>
                </div>
                {c.auth === "key" ? (
                  <div className="form-grid">
                    <label>
                      Approved agent key
                      <select
                        value={c.key_ref || ""}
                        onChange={(e) =>
                          change(c.id, { key_ref: e.target.value })
                        }
                      >
                        <option value="">Choose approved key</option>
                        {keys.map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                      <small>
                        Place keys in the configured agent key directory (0600).
                        Browser file paths are not used.
                      </small>
                    </label>
                    <label>
                      Key passphrase
                      <input
                        autoComplete="new-password"
                        type="password"
                        value={c.key_passphrase || ""}
                        placeholder={
                          board ? "Leave blank to retain saved secret" : ""
                        }
                        onChange={(e) =>
                          change(c.id, { key_passphrase: e.target.value })
                        }
                      />
                    </label>
                  </div>
                ) : (
                  <label>
                    Password
                    <input
                      autoComplete="new-password"
                      type="password"
                      value={c.password || ""}
                      placeholder={
                        c.password_saved
                          ? "Saved securely · leave blank to retain"
                          : ""
                      }
                      onChange={(e) =>
                        change(c.id, { password: e.target.value })
                      }
                    />
                  </label>
                )}
              </>
            ) : (
              <>
                <div className="form-grid">
                  <label>
                    Agent serial port
                    <div className="input-action">
                      <select
                        value={c.device || ""}
                        onChange={(e) =>
                          change(c.id, { device: e.target.value })
                        }
                      >
                        <option value="">Choose detected port</option>
                        {c.device &&
                          !ports.some((p) => p.device === c.device) && (
                            <option value={c.device}>
                              {c.device} (not detected)
                            </option>
                          )}
                        {ports.map((p) => (
                          <option key={p.device} value={p.device}>
                            {p.device} · {p.description}
                          </option>
                        ))}
                      </select>
                      <button
                        aria-label="Refresh serial ports"
                        onClick={refreshPorts}
                      >
                        <RefreshCw size={16} />
                      </button>
                    </div>
                    {!ports.length && (
                      <small>
                        No ports detected. Attach an adapter and refresh.
                      </small>
                    )}
                  </label>
                  <label>
                    Baud rate
                    <select
                      value={c.baud}
                      onChange={(e) =>
                        change(c.id, { baud: Number(e.target.value) })
                      }
                    >
                      {[
                        9600, 19200, 38400, 57600, 115200, 230400, 460800,
                        921600,
                      ].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Console username (optional)
                    <input
                      autoComplete="off"
                      value={c.login_username || ""}
                      onChange={(e) =>
                        change(c.id, { login_username: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Console password (optional)
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={c.login_password || ""}
                      placeholder={
                        c.login_password_saved
                          ? "Saved securely · leave blank to retain"
                          : ""
                      }
                      onChange={(e) =>
                        change(c.id, { login_password: e.target.value })
                      }
                    />
                  </label>
                </div>
                <details>
                  <summary>Advanced serial settings</summary>
                  <div className="form-grid">
                    <label>
                      Data bits
                      <select
                        value={String(c.advanced?.bytesize || 8)}
                        onChange={(e) =>
                          change(c.id, {
                            advanced: {
                              ...c.advanced,
                              bytesize: Number(e.target.value),
                            },
                          })
                        }
                      >
                        {[7, 8].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Parity
                      <select
                        value={String(c.advanced?.parity || "N")}
                        onChange={(e) =>
                          change(c.id, {
                            advanced: { ...c.advanced, parity: e.target.value },
                          })
                        }
                      >
                        {["N", "E", "O"].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Stop bits
                      <select
                        value={String(c.advanced?.stopbits || 1)}
                        onChange={(e) =>
                          change(c.id, {
                            advanced: {
                              ...c.advanced,
                              stopbits: Number(e.target.value),
                            },
                          })
                        }
                      >
                        {[1, 2].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!!c.advanced?.rtscts}
                        onChange={(e) =>
                          change(c.id, {
                            advanced: {
                              ...c.advanced,
                              rtscts: e.target.checked,
                            },
                          })
                        }
                      />{" "}
                      RTS / CTS flow control
                    </label>
                  </div>
                </details>
              </>
            )}
            {result?.connections.find((v) => v.type === c.type) && (
              <div className="verification">
                <Badge
                  state={
                    result.connections.find((v) => v.type === c.type)!.state
                  }
                />
                <p>
                  {result.connections.find((v) => v.type === c.type)?.error}
                </p>
              </div>
            )}
          </div>
        ))}
        <div className="add-connection">
          <button
            disabled={connections.length >= 2 || busy}
            onClick={() => setAdding(!adding)}
          >
            <Plus size={17} /> Add connection
          </button>
          {adding && (
            <div className="connection-choices">
              <button
                disabled={connections.some((c) => c.type === "ssh")}
                onClick={() => add("ssh")}
              >
                <Terminal /> SSH <small>Linux remote shell</small>
              </button>
              <button
                disabled={connections.some((c) => c.type === "uart")}
                onClick={() => add("uart")}
              >
                <Radio /> Serial / UART <small>Boot logs and console</small>
              </button>
            </div>
          )}
        </div>
        <div className="note">
          <Info size={20} />
          <div>
            <strong>Automatic recovery</strong>
            <p>
              SSH is tried first. A verified UART Linux shell can provide
              control when SSH is unavailable. Unknown command outcomes are
              never replayed. Network tests still require SSH networking.
            </p>
          </div>
        </div>
        {board && (
          <details open>
            <summary>Board settings · inherited defaults and overrides</summary>
            <div className="settings-grid">
              {Object.entries(state.defaults).map(([key, global]) => (
                <div className="setting" key={key}>
                  <label>
                    {label(key)}{" "}
                    <small>
                      {key in overrides
                        ? "Board override"
                        : "Inherited global default"}{" "}
                      · effective:{" "}
                      {String(
                        key in overrides ? overrides[key] : (global ?? "None"),
                      )}
                    </small>
                    {key === "default_suite" ? (
                      <select
                        value={String(overrides[key] ?? global ?? "")}
                        onChange={(e) => {
                          setOverrides((o) => ({
                            ...o,
                            [key]: e.target.value || null,
                          }));
                          invalidate();
                        }}
                      >
                        <option value="">None</option>
                        {state.suites.map((s) => (
                          <option value={s.id} key={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    ) : key === "uart_log_capture" ? (
                      <select
                        value={String(overrides[key] ?? global)}
                        onChange={(e) => {
                          setOverrides((o) => ({
                            ...o,
                            [key]: e.target.value === "true",
                          }));
                          invalidate();
                        }}
                      >
                        <option value="true">Enabled</option>
                        <option value="false">Disabled</option>
                      </select>
                    ) : (
                      <input
                        type="number"
                        min={1}
                        max={3600}
                        value={Number(overrides[key] ?? global)}
                        onChange={(e) => {
                          setOverrides((o) => ({
                            ...o,
                            [key]: Number(e.target.value),
                          }));
                          invalidate();
                        }}
                      />
                    )}
                  </label>
                  <button
                    className="subtle"
                    disabled={!(key in overrides)}
                    onClick={() => {
                      setOverrides((o) => {
                        const n = { ...o };
                        delete n[key];
                        return n;
                      });
                      invalidate();
                    }}
                  >
                    Use global default
                  </button>
                </div>
              ))}
            </div>
            <p className="muted">
              Create suites using “Manage suites” in Overview, then assign one
              here. Active runs keep their captured settings.
            </p>
          </details>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!result && (
          <p className="muted">
            {connections.length
              ? "This configuration is not verified. Saving is allowed."
              : "Add at least one connection."}
          </p>
        )}
      </div>
      <footer className="modal-footer">
        <button
          disabled={busy || !name || !connections.length}
          onClick={() => verify()}
        >
          <Link size={16} /> {busy ? "Verifying…" : "Verify connections"}
        </button>
        <div className="actions">
          <button onClick={close}>Cancel</button>
          <button
            className="primary"
            disabled={busy || !name || !connections.length}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/boards", {
                  ...payload(),
                  receipt: result?.receipt,
                });
                saved();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {board
              ? "Save settings"
              : result
                ? "Add Board"
                : "Add · Not verified"}
          </button>
        </div>
      </footer>
    </Modal>
  );
}
function RunDialog({
  state,
  board,
  close,
  started,
}: {
  state: State;
  board?: Board;
  close: () => void;
  started: (id: string) => void;
}) {
  const [bid, setBid] = useState(board?.id || state.boards[0]?.id || ""),
    [choice, setChoice] = useState("inventory"),
    [params, setParams] = useState<Record<string, string>>({}),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [verification, setVerification] = useState<Verification[]>([]);
  const suite = state.suites.find((s) => "suite:" + s.id === choice),
    definition = state.catalog.find((t) => t.id === choice),
    items = suite
      ? suite.stages.map((s) => ({
          test: s.test,
          parameters: s.parameters,
          confirmed,
        }))
      : [{ test: choice, parameters: params, confirmed }];
  const risky = items.some((i) => ["custom", "reboot"].includes(i.test));
  return (
    <Modal title="Run Test" onClose={close} wide>
      <div className="modal-body">
        <p className="muted">
          Review the execution plan. Tests run in background workers and
          continue when you leave this page.
        </p>
        <div className="form-grid">
          <label>
            Board
            <select
              value={bid}
              onChange={(e) => {
                setBid(e.target.value);
                setVerification([]);
              }}
            >
              {state.boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Test or suite
            <select
              value={choice}
              onChange={(e) => {
                setChoice(e.target.value);
                setConfirmed(false);
                setParams({});
              }}
            >
              <optgroup label="Individual tests">
                {state.catalog.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Saved suites">
                {state.suites.map((s) => (
                  <option key={s.id} value={"suite:" + s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
        </div>
        {definition && (
          <>
            <p>{definition.purpose}</p>
            {Object.entries(definition.parameters).map(([k, description]) => (
              <label key={k}>
                {description}
                {k === "script" ? (
                  <textarea
                    rows={8}
                    className="code-input"
                    value={params[k] || ""}
                    onChange={(e) => {
                      setParams((p) => ({ ...p, [k]: e.target.value }));
                      setConfirmed(false);
                    }}
                  />
                ) : (
                  <input
                    value={params[k] || ""}
                    placeholder={k === "expected_exit" ? "0" : ""}
                    onChange={(e) =>
                      setParams((p) => ({ ...p, [k]: e.target.value }))
                    }
                  />
                )}
              </label>
            ))}
          </>
        )}
        {items.map((item, i) => {
          const d = state.catalog.find((t) => t.id === item.test)!;
          return (
            <div className="plan" key={i}>
              <div className="section-head">
                <h3>
                  Stage {i + 1} · {d.name}
                </h3>
                <span className="tag">
                  {d.resources.join(", ")} · {d.timeout}s default
                </span>
              </div>
              <p>
                <strong>Prerequisites:</strong> {d.prerequisites.join(" · ")}
              </p>
              <p>
                <strong>Required capabilities:</strong>{" "}
                {d.capabilities.join(", ")}
              </p>
              <ol>
                {d.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {suite && Object.keys(item.parameters).length > 0 && (
                <pre>{JSON.stringify(item.parameters, null, 2)}</pre>
              )}
              <p>
                <strong>Pass condition:</strong> {d.checks}
              </p>
              <small>Cleanup: {d.cleanup}</small>
            </div>
          );
        })}
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api(`/boards/${bid}/verify`, {});
              setVerification(r.connections);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw size={15} /> Check connection prerequisites
        </button>
        <p className="muted">
          Target tools and permissions are checked by the worker before
          execution. No packages are installed automatically.
        </p>
        {verification.map((v, i) => (
          <p key={i}>
            <strong>{v.type.toUpperCase()}:</strong> {label(v.state)} {v.error}
          </p>
        ))}
        {risky && (
          <label className="check warning">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            I reviewed all scripts, prerequisites and side effects, and
            explicitly authorize any reboot in this plan.
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="modal-footer">
        <span className="muted">
          Sequential suite stages · resource conflicts enforced
        </span>
        <div className="actions">
          <button onClick={close}>Cancel</button>
          <button
            className="primary"
            disabled={busy || !bid || (risky && !confirmed)}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api("/runs", {
                  board_id: bid,
                  ...(suite
                    ? { suite_id: suite.id, confirmed }
                    : {
                        items: items.map((i) => ({
                          ...i,
                          parameters: {
                            ...i.parameters,
                            ...(i.test === "custom"
                              ? {
                                  expected_exit:
                                    i.parameters.expected_exit || "0",
                                }
                              : {}),
                          },
                        })),
                      }),
                });
                started(r.id);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Play size={15} /> Start {suite ? "suite" : "test"}
          </button>
        </div>
      </footer>
    </Modal>
  );
}
function SuiteDialog({
  state,
  close,
  saved,
}: {
  state: State;
  close: () => void;
  saved: () => void;
}) {
  const [id, setId] = useState(""),
    [name, setName] = useState(""),
    [stages, setStages] = useState<Suite["stages"]>([
      { test: "inventory", parameters: {} },
    ]),
    [error, setError] = useState("");
  return (
    <Modal title="Test suites" onClose={close} wide>
      <div className="modal-body">
        <p className="muted">
          Saved plans run stages sequentially. Assign a suite in Board settings
          after saving.
        </p>
        <label>
          Edit suite
          <select
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              const s = state.suites.find((s) => s.id === e.target.value);
              setName(s?.name || "");
              setStages(s?.stages || [{ test: "inventory", parameters: {} }]);
            }}
          >
            <option value="">Create new suite</option>
            {state.suites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Suite name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {stages.map((s, i) => (
          <div className="connection-editor" key={i}>
            <div className="section-head">
              <h3>Stage {i + 1}</h3>
              <button
                className="icon"
                aria-label={`Remove stage ${i + 1}`}
                disabled={stages.length === 1}
                onClick={() => setStages(stages.filter((_, n) => n !== i))}
              >
                <Trash2 size={15} />
              </button>
            </div>
            <label>
              Test
              <select
                value={s.test}
                onChange={(e) =>
                  setStages(
                    stages.map((x, n) =>
                      n === i ? { test: e.target.value, parameters: {} } : x,
                    ),
                  )
                }
              >
                {state.catalog.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            {Object.entries(
              state.catalog.find((t) => t.id === s.test)!.parameters,
            ).map(([k, v]) => (
              <label key={k}>
                {v}
                {k === "script" ? (
                  <textarea
                    rows={6}
                    value={s.parameters[k] || ""}
                    onChange={(e) =>
                      setStages(
                        stages.map((x, n) =>
                          n === i
                            ? {
                                ...x,
                                parameters: {
                                  ...x.parameters,
                                  [k]: e.target.value,
                                },
                              }
                            : x,
                        ),
                      )
                    }
                  />
                ) : (
                  <input
                    value={s.parameters[k] || ""}
                    onChange={(e) =>
                      setStages(
                        stages.map((x, n) =>
                          n === i
                            ? {
                                ...x,
                                parameters: {
                                  ...x.parameters,
                                  [k]: e.target.value,
                                },
                              }
                            : x,
                        ),
                      )
                    }
                  />
                )}
              </label>
            ))}
          </div>
        ))}
        <button
          disabled={stages.length >= 20}
          onClick={() =>
            setStages((s) => [...s, { test: "inventory", parameters: {} }])
          }
        >
          <Plus size={15} /> Add stage
        </button>
        {error && <p className="error">{error}</p>}
      </div>
      <footer className="modal-footer">
        <button onClick={close}>Close</button>
        <button
          className="primary"
          disabled={!name}
          onClick={async () => {
            try {
              await api("/suites", { id: id || undefined, name, stages });
              saved();
              setError("Suite saved. You can assign it in Board settings.");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Save suite
        </button>
      </footer>
    </Modal>
  );
}
function History({
  state,
  board,
  close,
  onLogs,
}: {
  state: State;
  board?: Board;
  close: () => void;
  onLogs: (r: Run) => void;
}) {
  const [bid, setBid] = useState(board?.id || ""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(0),
    [rows, setRows] = useState<Run[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    api(
      `/history?page=${page}&${bid ? "board_id=" + bid + "&" : ""}${status ? "state=" + status : ""}`,
    )
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [page, bid, status]);
  return (
    <Modal title="Run history" onClose={close} wide>
      <div className="modal-body">
        <div className="filters">
          <label>
            Board
            <select
              value={bid}
              onChange={(e) => {
                setBid(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All boards (including removed)</option>
              {state.boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Result
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All states</option>
              {[
                "passed",
                "failed",
                "blocked",
                "cancelled",
                "interrupted",
                "infrastructure_error",
                "timed_out",
              ].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ResultsTable runs={rows} state={state} onLogs={onLogs} />
        {error && <p className="error">{error}</p>}
      </div>
      <footer className="modal-footer">
        <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <span>Page {page + 1}</span>
        <button
          disabled={rows.length < 20}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </footer>
    </Modal>
  );
}
function Console({ board, close }: { board: Board; close: () => void }) {
  const [cmd, setCmd] = useState(""),
    [output, setOutput] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title={`${board.name} · Console`} onClose={close} wide>
      <div className="modal-body">
        <div className="note">
          <Terminal size={18} />
          <p>
            Authenticated command console. Commands are serialized and
            unavailable during automation. This phase supports command /
            response, not a full interactive TTY. UART output is also available
            in Live Logs.
          </p>
        </div>
        <pre className="console-output" aria-live="polite">
          {output || "No commands submitted."}
        </pre>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setOutput((o) => o + "\n$ " + cmd + "\n");
            try {
              const r = await api(`/boards/${board.id}/console`, {
                command: cmd,
              });
              setOutput(
                (o) =>
                  o +
                  clean(r.stdout) +
                  clean(r.stderr) +
                  `\n[exit ${r.exit_status}]\n`,
              );
              setCmd("");
            } catch (e) {
              setOutput((o) => o + "\n" + (e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Shell command
            <input
              className="code-input"
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              disabled={busy}
            />
          </label>
          <button disabled={busy || !cmd} className="primary">
            <Send size={15} /> {busy ? "Running…" : "Execute command"}
          </button>
        </form>
      </div>
    </Modal>
  );
}
function Confirm({
  kind,
  board,
  state,
  close,
  execute,
}: {
  kind: string;
  board: Board;
  state: State;
  close: () => void;
  execute: (b: unknown) => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false);
  const suite = state.suites.find(
    (s) =>
      s.id === (board.overrides.default_suite || state.defaults.default_suite),
  );
  return (
    <Modal title={`${label(kind)} · ${board.name}`} onClose={close}>
      <div className="modal-body">
        <p>
          {kind === "remove"
            ? "Remove this board configuration? Historical runs, logs and reports will be preserved."
            : kind === "reboot"
              ? "This requests a real target reboot and requires exclusive board access. Recovery must prove a changed Linux boot ID."
              : kind === "stop"
                ? "Request cooperative cancellation of every active and queued run on this board. Remote process cleanup can be uncertain if the connection has failed."
                : `Start saved suite “${suite?.name}”? Review every stage below. No conflicting execution is allowed.`}
        </p>
        {kind === "suite" &&
          suite?.stages.map((s, i) => (
            <div className="plan" key={i}>
              <strong>
                Stage {i + 1} · {s.test}
              </strong>
              <pre>{JSON.stringify(s.parameters, null, 2)}</pre>
            </div>
          ))}
        {kind === "remove" ? (
          <label>
            Type “{board.name}” to confirm
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        ) : (
          <label className="check">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />{" "}
            I reviewed and authorize this action, including any script or reboot
            in this plan.
          </label>
        )}
      </div>
      <footer className="modal-footer">
        <button onClick={close}>Cancel</button>
        <button
          className="primary"
          disabled={
            busy || (kind === "remove" ? name !== board.name : !checked)
          }
          onClick={async () => {
            setBusy(true);
            try {
              await execute({ confirm: name });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Submitting…" : "Confirm " + label(kind)}
        </button>
      </footer>
    </Modal>
  );
}
function Logs({
  board,
  run,
  state,
  choose,
}: {
  board?: Board;
  run?: Run;
  state: State;
  choose: (bid: string, rid: string) => void;
}) {
  const [lines, setLines] = useState<Log[]>([]),
    [source, setSource] = useState(""),
    [paused, setPaused] = useState(false),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [copy, setCopy] = useState(false);
  const cursor = useRef(0),
    end = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    generation = useRef(0);
  const query = `${board ? "board_id=" + board.id + "&" : ""}${run ? "run_id=" + run.id + "&" : ""}${source ? "source=" + source + "&" : ""}`;
  useEffect(() => {
    let alive = true;
    generation.current++;
    cursor.current = 0;
    setLines([]);
    setError("");
    setNotice("");
    if (!board && !run) return;
    api("/logs?" + query + "before=9223372036854775807")
      .then((rows: Log[]) => {
        if (!alive) return;
        setLines(rows);
        cursor.current = rows.at(-1)?.id || 0;
        if (rows.length === 300)
          setNotice(
            "Showing latest 300 records. Load older evidence or export the full capture.",
          );
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, [query]);
  useEffect(() => {
    if (paused || (!board && !run)) return;
    let es: EventSource | undefined,
      alive = true;
    const timer = setTimeout(() => {
      if (!alive) return;
      es = new EventSource(
        "/api/logs/stream?" + query + "after=" + cursor.current,
        { withCredentials: true },
      );
      es.onmessage = (e) => {
        const incoming: Log[] = JSON.parse(e.data);
        setLines((previous) => {
          const seen = new Set(previous.map((l) => l.id));
          const next = [
            ...previous,
            ...incoming.filter((l) => !seen.has(l.id)),
          ];
          if (next.length > 1000)
            setNotice(
              "Display limited to 1,000 records. Earlier evidence remains stored locally; use Load older or Export.",
            );
          return next.slice(-1000);
        });
        cursor.current = incoming.at(-1)?.id || cursor.current;
        setError("");
      };
      es.onerror = () =>
        setError(
          "Log stream reconnecting. Capture remains agent-side; inspect agent status if this persists.",
        );
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
      es?.close();
    };
  }, [query, paused]);
  useEffect(() => {
    if (
      !paused &&
      scroll.current &&
      scroll.current.scrollHeight -
        scroll.current.scrollTop -
        scroll.current.clientHeight <
        250
    )
      end.current?.scrollIntoView({ block: "nearest" });
  }, [lines, paused]);
  const visible = lines.filter((l) =>
    clean(l.raw).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section
      id="logs-panel"
      role="tabpanel"
      aria-label="Logs"
      className="panel logs-panel"
    >
      <div className="panel-heading">
        <h2>
          <Terminal size={17} /> Live Logs
        </h2>
        <span className="mini-label">
          {paused ? "DISPLAY PAUSED" : "LOCAL EVIDENCE"}
        </span>
      </div>
      <div className="log-selectors">
        <select
          aria-label="Log board"
          value={board?.id || ""}
          onChange={(e) => choose(e.target.value, "")}
        >
          <option value="">Select board</option>
          {state.boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Log run"
          value={run?.id || ""}
          onChange={(e) => choose(board?.id || "", e.target.value)}
        >
          <option value="">Board session</option>
          {run && !state.active.some((r) => r.id === run.id) && (
            <option value={run.id}>
              {run.name} · {run.state}
            </option>
          )}
          {state.active
            .filter((r) => r.board_id === board?.id)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </select>
        <select
          aria-label="Log source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">All sources</option>
          {[
            "uart",
            "stdout",
            "stderr",
            "event",
            "console_stdout",
            "console_stderr",
          ].map((s) => (
            <option key={s} value={s}>
              {s === "uart" ? "UART (board session)" : label(s)}
            </option>
          ))}
        </select>
      </div>
      <div className="log-search">
        <Search size={14} />
        <input
          aria-label="Search captured output"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search loaded output…"
        />
        <button
          disabled={!lines.length}
          onClick={async () => {
            try {
              const old: Log[] = await api(
                "/logs?" + query + "before=" + lines[0].id,
              );
              setLines((rows) => [...old, ...rows].slice(0, 1000));
              setPaused(true);
              setNotice(
                old.length
                  ? "Older evidence loaded; display paused. Resume to follow live output."
                  : "Beginning of retained evidence.",
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Older
        </button>
      </div>
      <div
        className="terminal"
        ref={scroll}
        role="log"
        aria-label="Captured original output"
        aria-live="off"
      >
        {!board && !run ? (
          <div className="terminal-empty">
            <Terminal size={30} />
            <strong>Your evidence, as captured.</strong>
            <p>
              Select a board or run to inspect original output.
              <br />
              Connection events and UART sessions stay distinct.
            </p>
          </div>
        ) : !lines.length ? (
          <div className="terminal-empty">
            <Activity size={28} />
            <p>No captured output for this context.</p>
          </div>
        ) : (
          visible.map((l) => (
            <div key={l.id} className={"log-line " + l.source}>
              <span className="log-meta">
                L{l.id} · {new Date(l.timestamp * 1000).toLocaleTimeString()} ·{" "}
                {l.source}
              </span>
              <pre>{clean(l.raw)}</pre>
            </div>
          ))
        )}
        <div ref={end} />
      </div>
      {notice && <small className="log-notice">{notice}</small>}
      {error && <small className="error">{error}</small>}
      <div className="log-actions">
        <button onClick={() => setPaused(!paused)}>
          {paused ? <Play size={14} /> : <Pause size={14} />}{" "}
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          disabled={!visible.length}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                visible
                  .map((l) => `[L${l.id} ${l.source}] ${clean(l.raw)}`)
                  .join("\n"),
              );
              setCopy(true);
              setTimeout(() => setCopy(false), 1500);
            } catch {
              setError("Clipboard unavailable in this browser. Use Export.");
            }
          }}
        >
          <Copy size={14} /> {copy ? "Copied" : "Copy"}
        </button>
        <a
          className={"button " + (!board ? "disabled" : "")}
          href={"/api/logs/export?" + query}
          download
        >
          <Download size={14} /> Export
        </a>
      </div>
      {run && (
        <small className="muted">
          UART is board-session evidence. Select Board session + UART to inspect
          it.
        </small>
      )}
    </section>
  );
}
function Assistant({
  board,
  run,
  configured,
}: {
  board?: Board;
  run?: Run;
  configured: boolean;
}) {
  const [question, setQuestion] = useState(""),
    [history, setHistory] = useState<{ question: string; answer: string }[]>(
      [],
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const context = useRef("");
  useEffect(() => {
    const key = (board?.id || "") + (run?.id || "");
    context.current = key;
    setHistory([]);
    setError("");
    if (board)
      api(`/ai/history?board_id=${board.id}${run ? "&run_id=" + run.id : ""}`)
        .then((r) => {
          if (context.current === key) setHistory(r);
        })
        .catch((e) => setError(e.message));
  }, [board?.id, run?.id]);
  return (
    <section
      id="assistant-panel"
      role="tabpanel"
      aria-label="Assistant"
      className="panel assistant-panel"
    >
      <div className="panel-heading">
        <h2>
          <Sparkles size={18} /> AI Assistant
        </h2>
        <span className="tag">Read only</span>
      </div>
      <div className="assistant-context">
        {board?.name || "No board selected"}
        {run ? " / " + run.name : ""}
      </div>
      <div className="conversation">
        {!configured ? (
          <div className="ai-empty">
            <div className="ai-symbol">
              <Sparkles size={25} />
            </div>
            <h3>Local AI not configured</h3>
            <p>
              Connect an explicitly configured local model to explain selected
              test evidence.
            </p>
            <p>Tests and raw logs work independently.</p>
            <details>
              <summary>Local setup</summary>
              <p>
                Set <code>[ai]</code> in config.toml: enabled, endpoint and
                installed model. Restart the agent. No cloud fallback or
                automatic model downloads.
              </p>
            </details>
          </div>
        ) : !history.length ? (
          <div className="ai-empty">
            <Sparkles size={26} />
            <h3>Inspect with context</h3>
            <p>
              Ask about observations, possible causes, or suggested checks.
              Responses should cite captured line IDs. Verify suggestions
              against raw evidence.
            </p>
          </div>
        ) : (
          history.map((h, i) => (
            <div className="exchange" key={i}>
              <p className="question">{h.question}</p>
              <pre>{h.answer}</pre>
            </div>
          ))
        )}
        {busy && <p className="muted">Waiting for local model…</p>}
        {error && <p className="error">{error}</p>}
      </div>
      <form
        className="assistant-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const key = context.current,
            q = question;
          try {
            const r = await api("/ai/ask", {
              board_id: board?.id,
              run_id: run?.id,
              question: q,
            });
            if (context.current === key) {
              setHistory((h) => [...h, { question: q, answer: r.answer }]);
              setQuestion("");
            }
          } catch (e) {
            if (context.current === key) setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          aria-label="Ask local AI"
          placeholder={
            configured ? "Ask about this evidence…" : "Local AI not configured"
          }
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={!configured || !board || busy}
        />
        <button
          aria-label="Send question"
          disabled={!configured || !board || busy || !question}
        >
          <Send size={20} />
        </button>
      </form>
      <small className="assistant-disclaimer">
        Bounded local context · Suggestions only · No command execution
      </small>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
