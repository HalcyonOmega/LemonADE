# LemonADE

**Agentic Development Environment (ADE)** — an **IDE-shaped product** that evolves how developers work: **windows, panels, and workflow are organized around agent runs, orchestration, and review**, not around solo typing in a disconnected editor + six browser tabs.

## What we are actually building

- **Not** a bolt-on file you drop into every repository so a sidecar app can find you. The ADE **is** the environment: you **open workspaces** here the same way you open a folder in VS Code or Cursor, and the app **owns** layout, sessions, and agent context.
- **Not** “terminal multiplexer 2.0” as the headline. Terminals, preview, diffs, and checks exist **in service of agentic coding**—bound to **which agent run** or **which work stream** they belong to, with **addressable** notifications and focus.
- **An evolution of the IDE**: the **primary objects** in the UI should become **workspaces → agent runs / orchestration → artifacts to review** (plans, diffs, logs, verify results). Editing stays important, but **reframed** as part of steering and validating agents, not as the only center of gravity.

That is the bar for “agentic developer environment”: users experience **agent-driven development inside one coherent IDE**, not scattered tools plus a manifest hunt.

## Honest state of *this repository*

The **current Electron build** is still an **early foundation**: multi-root list, PTY, embedded preview (BrowserView), verify subprocess, notifications. It temporarily used a **`lemonade.project.json` gate** to bootstrap behavior—that was the wrong **product** story (it reads like an appendage to foreign repos). **That model is being retired in favor of IDE-style workspaces and ADE-owned settings** (see [docs/MVP-PLAN.md](docs/MVP-PLAN.md)).

So: **vision = ADE as next-gen IDE**; **today’s code = groundwork we will reshape** to match that vision, not the final UX.

## Roadmap (product), in order

1. **Open Folder / workspace** — First-class like any IDE; optional **`.lemonade/`** (or app-only state) for preview ports, verify commands—**no requirement to touch upstream repos**.
2. **Agent rail** — Registry of runs (running / done / failed), focus from notifications, clear **session** identity in the shell.
3. **Orchestration-first layout** — **Primary** left: **workspaces** (right-click a workspace to **remove** it, with confirmation). **Rail:** **worktrees / cwd**. **Right:** **file tree** for the current checkout. **Center:** **mosaic** of preview, agents, terminal, editor, activity — **drag** panel titles to reorder (drop indicator shows slot); **drag** splitters between panels and between rows to resize; layout persisted under `sessionStorage` key `lemonade.mosaic.v2` (migrates from v1). **Add tile** / **In row →** / **New row ↓** still apply.
4. **Editor & diff** — Monaco/CodeMirror (or embed) for read/write and **patch review** as part of the agent loop. Today there is a **scratch textarea** backed by real `fs:read` / `fs:write` IPC confined to **cwd**, so swapping the UI for Monaco is a renderer-only change.
5. **Deep adapters** — Optional integrations with specific agent products; still **compose**, not fork, unless strategy changes.

## Notifications (agents & CLI)

- **OS notifications** + **in-app toasts** + **Activity** lines for each event.
- **Persistent pills** on each **workspace**, **worktree row**, and **agent session**: they consolidate unread signal by **severity** (`info` &lt; `activity` &lt; `attention` &lt; `alert`), show a **count** when multiple events stacked, and **clear** when you select that workspace, that worktree checkout, or **Focus** on that agent. State is kept in `sessionStorage` (`lemonade.notifyPills.v1`). HTTP `POST /notify` and PTY `LEMONADE_NOTIFY_JSON:{…}` may include optional **`cwd`** / **`worktreePath`**, **`ptyId`**, and **`level`** to route and style pills.
- **UI:** **Session → Test notify**; **Copy notify examples** puts a `curl` template and PTY one-liner on the clipboard.
- **HTTP (CLI / scripts):** On startup, LemonADE binds **127.0.0.1** to a random port and writes **`notify-endpoint.json`** under app user data (`port` + `token`). `POST` JSON `{ "title", "body", "projectPath"? }` with header `Authorization: Bearer <token>`.
- **PTY env:** Every shell/agent session receives **`LEMONADE_NOTIFY_PORT`** and **`LEMONADE_NOTIFY_TOKEN`** so scripts can call the same endpoint without reading files.
- **PTY line protocol:** A complete line `LEMONADE_NOTIFY_JSON:{"title":"…","body":"…"}` on stdout triggers a notification (line still appears in the terminal as usual).

## Agent “chat”

The Agents column **sends text to the focused PTY** (shell or agent)—same as typing in the terminal, with **Enter** to send and **Shift+Enter** for a newline. It is not a separate LLM channel yet; it is **orchestration input** into the session you have focused.

### Same worktree, multiple agents

**Yes — technically fine.** Each **New agent** (or shell) is a separate PTY with its own `cwd`. You can run **many agent sessions in the same checkout** at once; they do not block each other at the OS level.

**UI today:** One **Terminal** tile shows the **focused** session’s stream; the **Agents** list is the registry—**Focus** picks which session receives keyboard and chat input. **Worktree rail:** changing `cwd` does not kill sessions; it changes context for *new* work (and file tree / editor root). A natural next step for “chat-first” UX is **grouping the session list by `cwd` / branch** (or pinned tabs per session) so you stay on one worktree while jumping between agent threads—without making the rail the only place that shows “who is running where.”

**Mosaic:** Reorder by **dragging** panel headers; resize with **splitters** between columns and rows.

## Worktrees, files, and Codex-style CLIs

- **Git worktrees** drive **cwd** from the **worktree rail** (next to the workspace list). Each row sets cwd for shell, agents, verify, editor, and the file tree. If `git worktree list` fails, you still get the workspace root as the only row.
- **File browser:** **Right-hand sidebar**; click a file to open it in the **Editor** panel (same safe path rules as Open… / Save). Heavy dirs (`node_modules`, `.git`, `dist`, …) are hidden in the main process.
- **`agentCommand`:** In `.lemonade/settings.json`, set **`agentCommand`** to a shell string such as **`codex`** or **`pnpm exec codex`** (whatever your install uses). **New agent** then runs that via **`sh -lc`** (macOS/Linux) or **`cmd /c`** (Windows) in a PTY instead of a plain login shell. **Agent shell** appears when `agentCommand` is set and starts a **login-shell** agent session without that command, for debugging.

## Cursor “subagents”

Using **Cursor subagents while building** meant **parallel implementation help in the editor**—not “LemonADE runs subagents for you.” Product orchestration is **your** agent runs inside **this** ADE.

## Development (engineers)

- **Bun only:** `bun install`, `bun run …`
- **`bun run rebuild:native`** — required for **`node-pty`** (Electron ABI).
- **`bun run dev`** — LemonADE’s own Vite UI is on **5174**; do not confuse with your app under development.
- **Embedded preview:** If `previewUrl` points at a server that is not running (e.g. `http://127.0.0.1:3000`), the app **drops the BrowserView** instead of throwing; start your dev server and bring the Preview tile into view again to attach.
- **`bun run build` / `build:app`** — see [docs/MVP-PLAN.md](docs/MVP-PLAN.md) for stack details.

**Open folder** and optional **`.lemonade/settings.json`** (see [docs/lemonade-settings.example.json](docs/lemonade-settings.example.json)) are supported; legacy **`lemonade.project.json`** is still read if present.

## Why (problem space)

Parallel work explodes across terminals, browsers, and IDE windows; agent completions arrive **without spatial context**. An ADE fixes that by **binding surfaces to agent sessions and workspaces**—the same problem space as [Theo’s thread](https://x.com/theo/status/2018091358251372601?s=20) and [Karpathy’s notes on agent-heavy coding](https://x.com/karpathy/status/2031767720933634100), but solved as **one IDE**, not a patch on every repo.

## References

- [Theo — multi-project tooling and mental model](https://x.com/theo/status/2018091358251372601?s=20)
- [Karpathy — agent-heavy coding workflow and limitations](https://x.com/karpathy/status/2031767720933634100)
