# Verification — 30 October 2026

## Result

**26 backend tests passed; 2 browser scenarios passed; production frontend built successfully.**

Environment: Linux, Python 3.12.14, Node 24.22.1, npm 11.9.0, Chromium 141 via Playwright 1.56.1. A Starlette/httpx deprecation warning remains in the test harness; no failing checks were left at delivery.

## Executed checks

| Area | Result and scope |
|---|---|
| Local startup/authentication | Actual uvicorn startup + Chromium login. Empty production dashboard, local account, correct zero counters. Unauthenticated state/log/SSE/export/key/console access rejected. |
| Request protection | CSRF failure, unapproved Origin and Host rejected. No permissive CORS. Authenticated downloads and SSE used in browser. |
| Configurations | SSH-only, UART-only and dual configurations saved through API; database reopened to verify persistence. Secrets absent from responses and plaintext DB; encryption-key permissions checked. |
| Verification | Per-transport failures; no reachability fabricated from invalid endpoints. Exact-payload receipt invalidation checked. Approved-key path traversal rejected. |
| SSH | Actual loopback Paramiko server, password auth, real key exchange, explicit SHA256 first-use approval and changed-key rejection. Command stdout/stderr and live output before command completion checked. |
| UART | POSIX pseudo-terminal shell fixture, unique Linux-shell probe, silent port classified only as opened, shared ownership, conflicting owner rejection, serialized commands and board-session log attribution. |
| Recovery | Injected SSH unavailability → established pseudo-terminal UART shell. Network-required operation rejected on UART. Unknown submitted command outcome marked interrupted, no replay. **No physical hardware recovery claim.** |
| Jobs/suites | Actual loopback SSH inventory and reviewed custom script stages; assertion failure, background completion, reviewed launch requirements, settings snapshot/inheritance, resource exclusions/read compatibility and suite persistence. |
| Cancellation | Real loopback SSH long-running command streamed evidence before cancellation; tracked session-leader cleanup confirmed. Queued cancellation submits no command. UART cleanup remains explicitly unconfirmed by design. |
| Restart | Persisted unfinished run becomes interrupted and reports potentially surviving remote processes; boards persist. No automatic replay. |
| Evidence | Raw non-UTF-8 byte roundtrip via base64, original source separation, split-chunk known-secret redaction, pagination/export, explicit quota error. |
| Browser logs | Live SSE, pause display while another process writes real local evidence, resume catch-up, loaded-output search, clipboard copy and JSONL download. |
| Browser plans/results | Suite editor, default-suite assignment, execution-plan review, launch, infrastructure-error result, paginated history and report link. |
| Selected-run stability | Two explicitly named UI fixture runs; selection changes right-hand evidence, survives state polling and placeholder navigation, and does not change run state. These are test-only view fixtures, not physical test results. |
| Menus/settings | Board settings, effective/default values, suite flow in browser; API blocks settings/removal/console/verification while queued or running. Removal preserves history. |
| Responsive/navigation | Desktop 1586×992 has no full-page scrolling. Narrow 390×844 has no horizontal overflow; accessible Logs/Assistant/Workspace tabs and visible assistant input. All five placeholder destinations verified. Desktop/mobile screenshots visually inspected internally. |
| AI disabled | No provider network call; honest “Local AI not configured” and independent testing. |
| AI interface | Local HTTP provider **stub**, sanitized bounded context, no tools/execution fields, persisted conversation and valid evidence line reference. **No actual model inference validated.** |
| Local assets | Built HTML references existing local assets; CSS has no external URL/import. Bundled URL strings inspected: SVG/MathML/XML namespaces and inert React error documentation links. |
| Browser egress | All browser requests in the main workflow intercepted; external requests would be aborted and recorded. **Zero external requests observed.** |
| Backend egress boundary | Browser-test backend installed a Python socket audit hook allowing loopback only. API workflows ran under it. Public board destination validation rejected 8.8.8.8. AI disables proxy-env/redirect following and validates private endpoints. |

The source contains no application telemetry initialization, update checks, cloud inference fallback, remote logging or CDN references. Dependencies were installed during setup; they are not downloaded at runtime.

## Limits of the offline check

The audit hook was process-level Python instrumentation, **not an OS firewall or packet capture**. Browser interception and static scans cover the tested application paths; they do not prove that every installed third-party package, OS service or future configuration cannot transmit data. No system-wide egress policy was installed. The README provides a dedicated-user firewall approach for the user's machine. Repeat with actual board/model allowlists and inspect firewall counters or packet captures before making stronger environment-wide claims.

## Requires the user's equipment/environment

- Physical SSH-only, UART-only and dual-board connection verification.
- Actual serial adapters, firmware console framing, login prompts, UART unplug/replug and port permissions.
- Physical SSH loss → UART control → SSH return at a safe boundary.
- Real reboot, root/sudo permissions and changed boot-ID recovery; no host reboot was issued during verification.
- Target-specific process-group cleanup, detached children and network-failure uncertainty.
- Real local model performance/quality and any private-network HTTPS service.
- Whole-OS firewall validation, real disk-full faults, power-loss behavior and long-duration load/soak testing. Evidence quota behavior was tested; true filesystem exhaustion was not induced.

## Repeat

```bash
cd backend
../.venv/bin/python -m pytest -q
cd ../frontend
npm run build
npm run test:browser
cd ..
.venv/bin/python scripts/check_assets.py
```

Browser tests use a disposable separate directory and explicit test credentials. Production has no demo data. Never point the browser test server at production runtime data. The source package excludes installed dependencies, browser-test databases, credentials, logs, screenshots and model files.
