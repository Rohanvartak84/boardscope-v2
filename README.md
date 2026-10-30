# BoardScope — local embedded Linux test workbench

A working first release focused on **Overview**, with a React/TypeScript interface, FastAPI agent, SQLite evidence, Paramiko SSH and pyserial UART. Boards, Tests, Results, Assistant and Settings have navigable placeholder pages; essential actions remain within Overview. Production starts empty. The application has no analytics, hosted database or cloud AI integration. Source control on GitHub is separate from runtime: board configurations, credentials, logs and results remain local.

## Start locally

Tested with a Linux agent, Python 3.12 and Node 24. Requires Python **3.11+**, Node **22.12+** and npm. Linux is the supported agent OS for this phase (POSIX serial ownership, process groups, permissions and pseudo-terminal tests). The browser can run on another OS through a tunnel.

From the `boardscope` folder:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
cp config.example.toml config.toml
cd frontend
npm ci
npm run build
cd ../backend
../.venv/bin/python -m boardscope setup
../.venv/bin/python -m boardscope serve
```

Open **http://127.0.0.1:8000** and enter the password created in the terminal. There is one local administrator account. Minimum password length is 12 characters; no default production password exists. The checked-in example configuration selects `Asia/Kolkata`; without a config file the default is UTC. Change this to an IANA timezone before relying on daily counts.

After setup, `./scripts/start.sh` starts the complete app. The included `frontend/dist` in the ZIP is a prebuilt local frontend; rebuilding is optional when using those unchanged assets. No Node process is needed at runtime. Only one FastAPI process/worker is supported: serial ownership, sessions, scheduling and locks are agent-local. Never use multiple uvicorn workers.

### SSH tunnel

On your browser machine:

```bash
ssh -N -L 8000:127.0.0.1:8000 user@agent-machine
```

Browse http://127.0.0.1:8000 locally. All serial devices and key references resolve **on the agent machine**. Keep the backend bound to loopback. For a different browser-facing tunnel port, explicitly add its exact origin to `origins` in config.toml and restart. Do not expose this first release directly on an untrusted network. The SSH tunnel encrypts transit; loopback HTTP itself is not TLS.

## First use

1. **Add Board** → enter its name and add SSH and/or Serial/UART connections. SSH needs a private/local destination, port, username, and password or approved key reference. UART lists agent-detected ports and supports baud, optional login credentials and advanced serial framing.
2. **Verify connections** reports each transport separately. SSH first use displays a SHA256 host fingerprint for explicit approval. Compare it out of band with the board administrator. Changed keys are rejected, even if a new fingerprint is supplied. Opening UART is not reachability: the probe requires unique command-completion evidence followed by `Linux`. Login prompts, output-only ports and silent open ports are distinct states.
3. Save verified or **Not verified**. Editing configuration invalidates its verification receipt; the server also binds receipts to the exact payload, expires them after five minutes and makes them single use. Saved secrets never return to the browser; a blank secret field on editing retains its saved value. Remove/re-add that connection to clear its saved credential.
4. Select a board card to choose its context. A card never navigates away. Its test dropdown preserves the selected run across polling; there is no rotation. Select a run or use **View Logs** to follow it.
5. **Run Test** → choose a board/test, parameters, check connection prerequisites and review the plan. The worker rechecks target tools and permissions. Reboot and custom scripts need explicit review/confirmation. No packages are installed on targets.
6. **Manage suites** creates named, reusable sequential plans with parameters. Then use the board menu → **Board settings** to assign a default suite. **Start configured suite** requires an idle board. **View test plan** shows saved default stages or active stage information.
7. Use **Recent Results / View history** for paginated history, board/status filters, logs and downloadable JSON reports. Removing a board preserves evidence and run snapshots while deleting its saved credentials from its retained board record.

### Catalog and execution

- **System inventory:** OS release, kernel, CPU, memory and boot identity. Commands must exit zero.
- **Basic connectivity:** three target-side ICMP probes to an explicit private destination. Requires SSH, `ping`, and the documented expectation that ICMP is allowed. The agent resolves and pins a private IP before the command. UART-only configurations get a prerequisite error for this network test.
- **Reboot recovery:** reads boot ID, checks root/noninteractive sudo, submits one reboot request, waits for shell recovery and requires a different boot ID. Never replays a reboot after uncertain submission.
- **Custom script:** reviewed POSIX shell script, expected exit status and exclusive board access. Missing/nonexecutable dependencies (126/127) are prerequisite errors. Scripts must declare/review their own dependencies and side effects; BoardScope does not infer every dependency or undo arbitrary script modifications.

SSH targets need `sh`, `setsid` with `-w` support, `uname`, `cat`, and standard shell/core utilities. Reboot needs root or preconfigured `sudo -n`. A target lacking tools/permissions is blocked; BoardScope does not install them. No automatic sudo password entry occurs.

Four worker threads and a bounded queue of 64 jobs serve all boards. Suites are sequential. Compatible SSH read-only inventory runs can overlap; conflicting network runs serialize. Reboot/custom scripts are exclusive. UART or dual-connection boards serialize entire runs, reserving recovery capability; all UART commands share one gate. Interactive console access and verification require an idle/exclusively acquired board and cannot steal an automation session. The console is a bounded command/response terminal, **not a full interactive PTY**; full-screen tools and interactive password prompts are unsupported.

SSH is attempted first at a safe stage/start boundary; usable UART is the automatic fallback. A running command is never blindly resubmitted after loss. SSH commands use unique execution directories and tracked process-group IDs; loss reports the evidence path for manual inspection. Return to SSH occurs at the next safe stage/run boundary. There is no rapid transport oscillation. Reboot/reconnect always re-probes shell readiness.

Cancellation requests tracked SSH process-group termination and checks whether the tracked leader disappeared. Cleanup failures are reported. UART sends Ctrl-C and explicitly reports unconfirmed cleanup. Detached processes, a vanished transport, rebooted targets or scripts that escape process groups cannot always be cleaned up. Inspect those targets before retrying. Timeout, assertion failure, cancellation, blocked prerequisite, interrupted and infrastructure error remain distinct outcomes; only assertion failures increment **Failed today**. Queued runs are counted separately.

Runs continue without a browser. Effective settings, versioned definitions, parameters, OS/kernel when detected, timestamps, exit status, stage evidence, transport events and run IDs persist. Restart never resumes/replays work; unfinished records become interrupted, with uncertain remote state reported.

## Storage, credentials and authentication

Default runtime directory: `~/.local/share/boardscope` (override with `BOARDSCOPE_DATA`). It is created with mode 0700.

| Item | Location / behavior |
|---|---|
| SQLite | `boardscope.sqlite3`, mode 0600, WAL enabled; migration 1 and indexes created at startup |
| Boards/connections/settings/suites | SQLite records; credentials are Fernet-encrypted before insertion |
| Encryption key | `encryption.key`, mode 0600, **outside the database**; permission checks reject loose modes |
| Local password | `auth.json`, mode 0600; salted scrypt hash, no plaintext password |
| Host trust | `known_hosts`, mode 0600; trust only through verification fingerprint flow |
| Approved SSH private keys | Configured `key_directory`, default `~/.ssh/boardscope`; mode 0600, no symlinks or paths outside this directory |
| Raw evidence | SQLite `logs.raw` BLOB; base64 bytes included in JSONL exports alongside display text and source metadata |
| Reports | Generated from local evidence on download, not uploaded or retained in a hosted service |
| AI conversations | SQLite, only after an explicitly configured local model is used |
| Global configuration | `config.toml` or `BOARDSCOPE_CONFIG`, ignored by version control |

Use a dedicated OS account and full-disk encryption if your threat model includes disk theft. Fernet protects the database independently of its key, not against someone who controls the agent account and can read both. Back up the database **and encryption key together securely** after stopping the agent; losing the key makes stored credentials unreadable. Do not copy them into the source folder or source ZIP.

Authentication uses HttpOnly, SameSite=Strict session cookies (Secure when served through HTTPS), eight-hour in-memory sessions, per-session CSRF tokens, exact Host/Origin allowlists and login throttling. Logs, SSE, export, reports, keys, console and AI endpoints all require authentication. Sessions are intentionally invalidated by agent restart. This release provides one administrator, not multiuser roles or account recovery; rerun terminal `setup` to reset the password, then restart the agent.

### Logs, quotas and retention

Sources are accurate: `uart` is board-session output; `stdout` / `stderr` belong to tests; `event` is BoardScope execution/connection information; console output has separate source names. The app does not relabel UART as dmesg or attribute every UART byte to concurrent tests. Select **Board session → UART** to inspect serial evidence accompanying a run.

Known saved credential values are removed before evidence persistence, including values split between capture chunks. Redactions are explicit. Remaining original bytes are stored independently from presentation metadata; base64 preserves non-UTF-8 bytes. The browser strips terminal control sequences and uses text rendering, never raw HTML. Arbitrary secrets printed by a target that were never registered as credentials cannot be recognized automatically: do not print unrelated target secrets or put credentials inside custom scripts.

SSE streams incremental authenticated data; display pause closes the viewer stream but capture continues. Resume catches up from its last cursor. Search and copy operate on **loaded** output. Older loads are paginated. Browser rendering is bounded to 1,000 records; a visible notice identifies that display boundary. Full export streams all matching evidence. UART has a bounded receive buffer; a command falling behind reports a gap/uncertain outcome rather than succeeding.

`max_log_bytes` limits captured evidence bytes (default 256 MiB); it is not a whole-filesystem quota. Evidence is **never automatically pruned**. Hitting the limit explicitly stops capture / fails evidence-dependent runs, surfaces a capture alert and preserves prior evidence. Disk write errors likewise surface as infrastructure/capture errors. Export/archive before increasing the limit. Ensure free disk space for SQLite/WAL and conversations. To reset a full store without deleting evidence, stop the agent, securely archive the entire data directory, then start with a new `BOARDSCOPE_DATA` directory and reconfigure boards/account. No destructive retention operation is hidden behind removal or log pause.

## Optional local AI

Disabled by default. Tests do not need AI. Preinstall your model and local OpenAI-compatible inference service separately, then edit config.toml, for example:

```toml
[ai]
enabled = true
endpoint = "http://127.0.0.1:11434/v1"
model = "your-already-installed-model"
max_tokens = 512
```

Restart the agent. Only explicitly configured local/private addresses are accepted. Requests use a pinned resolved private IP, ignore proxy environment variables and do not follow redirects. For HTTPS use an endpoint with a valid IP certificate; HTTP loopback avoids IP/hostname certificate mismatch. There is no cloud provider, automatic download, fallback, tool access or generated-command execution.

Context includes sanitized board metadata, selected run/definition/configuration, up to 100 relevant evidence records (each truncated for context), bounded earlier results and your question. Prompts label logs as untrusted. Answers render as plain text and are separate from original logs. The provider is instructed to separate observations/possible causes, cite `[L123]`, and state insufficient evidence. Unknown citation IDs or missing citations when log evidence exists cause the response to be withheld. Citation ID validation cannot establish that a model's explanation is factually correct. Deterministic outcomes are never changed by AI. Conversation history persists and displays the last 20 exchanges; only the new question and bounded evidence are sent in this phase.

## Offline operation and destinations

Normal application runtime needs only:

- Browser → local FastAPI origin over loopback (or your intentional SSH tunnel).
- Agent → explicitly configured private/local boards, their SSH ports, or local serial devices.
- Optional agent → your explicit private/local model endpoint.
- Local DNS only if you configure hostnames. Prefer numeric approved IPs under strict egress rules.

Frontend assets/icons/scripts/styles are bundled, with system fonts and no CDN. There are no update checks, telemetry SDK initialization, analytics, remote logging or hosted persistence calls in application code. Dependency installation and Playwright's browser installation are setup activities. Downloads during setup require your configured Python/npm registries and Playwright distribution hosts; model downloads are user-managed setup, never triggered by BoardScope.

Build assets are checked by `scripts/check_assets.py`. Some third-party bundle strings are inert React error-documentation links and SVG namespace identifiers, not fetch destinations. See [VERIFICATION.md](VERIFICATION.md) for the actual measured checks and their limits. Do not treat this document as a claim that every OS process or physical network path has been firewalled.

For a fully offline installation, prepare a wheelhouse and npm cache on an approved connected setup machine with the same platform/Python version:

```bash
.venv/bin/python -m pip download -r requirements.lock -d /secure-transfer/wheels
cd frontend
npm ci --cache /secure-transfer/npm-cache
```

Transfer source, prebuilt dist and dependency caches through your approved route. Install with `pip install --no-index --find-links /secure-transfer/wheels -r requirements.lock`. If rebuilding frontend offline, use `npm ci --offline --cache /secure-transfer/npm-cache` with a complete cache. No dependency cache, model or installed dependency is included in the source ZIP.

### Restrict outbound traffic

Run the agent under a dedicated `boardscope` OS user, and restrict **only that user** using your firewall. Example nftables policy (requires administrator setup; substitute the actual approved board IP/ports):

```bash
sudo nft add table inet boardscope_guard
sudo nft 'add chain inet boardscope_guard output { type filter hook output priority 0; policy accept; }'
sudo nft add rule inet boardscope_guard output meta skuid boardscope oifname lo accept
sudo nft add rule inet boardscope_guard output meta skuid boardscope ip daddr 192.168.1.101 tcp dport 22 accept
# Add explicit private model-service / DNS rules if required, before the final reject.
sudo nft add rule inet boardscope_guard output meta skuid boardscope counter reject
```

Check firewall counters while exercising the application, including login, verification, tests, console, logs and AI. Apply equivalent IPv6 allow rules only for explicit approved destinations. Other user traffic is unaffected by the user-specific rules above. Do not apply an unrestricted system-wide drop policy on a remote workstation. Board-side network tests originate on the target and need separate target firewall policy. To remove this example guard: `sudo nft delete table inet boardscope_guard`.

## Development and tests

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
cd backend
../.venv/bin/python -m pytest -q
cd ../frontend
npm ci
npx playwright install chromium
npm run build
npm run test:browser
cd ..
.venv/bin/python scripts/check_assets.py
```

The test server has a disposable separate data directory, a test-only password and a Python audit hook rejecting non-loopback socket connections. It is **not the production startup command**. Transport tests create a loopback SSH server and pseudo-terminal; no physical board is implied. Two browser display-state fixtures are explicitly named and exist only inside that test. The test server must not share a production data directory. See VERIFICATION.md for outcomes.

Frontend development uses Vite's local proxy (`npm run dev`); add `http://127.0.0.1:5173` to the local origin allowlist for development. Production uses the single FastAPI origin and built assets. Do not enable a permissive CORS origin or expose Vite publicly.

## Source organization

- `backend/boardscope/config.py`: local configuration and private destination validation.
- `db.py`: SQLite schema/migration, records and indexes.
- `security.py`: account/session handling, encryption and sanitized board responses.
- `connections.py`: SSH trust, serial ownership, probing, command framing, recovery selection.
- `execution.py`, `catalog.py`: background jobs, suites, resource conflict gates, deterministic tests.
- `logs.py`: raw evidence, redaction, quotas and pagination.
- `ai.py`: optional read-only local inference boundary.
- `app.py`: authenticated API, SSE and bundled frontend serving.
- `frontend/src`: React UI, dialogs, cards, fixed panels and responsive shell.
- `backend/tests`, `frontend/tests`: meaningful backend/transport and browser tests.

## Known limits / deferred work

Physical board validation is still required for your console prompts, firmware/boot output, hot-unplug, real SSH loss→UART recovery, reboot privileges/boot-ID transitions, serial adapter ownership and target cancellation. The protocol supports standard Linux shells; unusual prompts, terminal echo/framing, menu consoles and bootloader-only UART sessions may need adapter-specific work. Serial auto-login is deliberately conservative and does not support arbitrary challenge-response prompts. A disconnected serial adapter may require explicit re-verification to restart continuous capture when no test is executing.

A real local model and TLS/private-network deployment were not validated here. HTTPS inference needs IP-valid certificates because the client pins the destination. Readiness is recent verified evidence, expires after two minutes, and is not background ping or a promise of a currently connected SSH session. Boards are not probed on every status refresh. Detailed per-board workspaces, full Settings/Boards/Tests/Results/Assistant pages, a full interactive TTY, user roles, JTAG/SWD/CAN/BMC/simulators, automated destructive retention and unattended reboot scheduling remain deferred.
