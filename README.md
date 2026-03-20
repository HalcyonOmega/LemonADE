# LemonADE

**Agentic Development Environment (ADE)** — a desktop app that keeps *projects* grouped across terminals, preview, ports, git, and agent runs.

## Why

When you juggle more than one codebase, work stops being “one mental model split across a few apps” and becomes a hunt: which terminal tab, which browser window, which `localhost` port, which agent run just finished. Existing tools optimize single surfaces (terminal multiplexers, IDE browsers, orchestration UIs) without fixing **cross-app, cross-project binding**.

LemonADE treats each **project** as the primary unit: everything you open or get notified about is **scoped to that project** so context does not collapse under parallel work.

## What v1 targets

- **Multi-project workspace** — Several repos or initiatives in one shell; selecting a project loads *its* context.
- **Embedded preview** — Per-project **webview** pointed at the dev URL (with an escape hatch to the system browser when needed).
- **Port clarity** — Stable, visible mapping per project so services are not silently fighting over the same port.
- **Terminals** — Tabs and sessions tied to a project (cwd, env, dev and agent processes).
- **Agent runs (orchestrated, BYO CLI)** — First-class **sessions**: lifecycle, logs, and notifications deep-link to the right project. You configure **which command** runs (e.g. your existing agent CLI); the ADE does not require forking a vendor product.
- **Verify loop** — Project-defined checks (e.g. lint, tests, typecheck). Runs surface in that project’s activity; failures are triaged **in place**. Correctness and maintainability over raw throughput.

## What v1 is not

- A replacement for your full IDE for heavy editing (opening an external editor remains fine).
- Team sync or shared cloud state (solo, local first). **Team-wide project definitions** are on the roadmap.
- “One Docker image solves dev env” as the core bet — optional invocation only.

## Principles

- **Compose, don’t fork** — Integrate with agents and tools via adapters and subprocesses; deep vendor integrations can come later.
- **Notifications are addressable** — A completion or failure should mean: *which project*, *what failed*, *where to look*.
- **Trust through verification** — Agent output is paired with checks you already trust in real engineering.

## Status

Early stage — product direction and architecture are being refined before implementation details (desktop stack, manifest format, process model) are locked.

## References

- [Theo — multi-project tooling and mental model](https://x.com/theo/status/2018091358251372601?s=20)
- [Karpathy — agent-heavy coding workflow and limitations](https://x.com/karpathy/status/2031767720933634100)
