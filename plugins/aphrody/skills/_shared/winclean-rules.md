# WinClean Integration Rules

**STRICT ENFORCEMENT ZONE - FATAL ERROR IF IGNORED**

Canonical source for the rule block previously duplicated across WinClean Claude Code skills. When a skill needs to advertise these constraints, link here instead of inlining.

1. **Toolchain**: NEVER use Node.js, npm, yarn, or pnpm. ALWAYS use `bun` and `bunx` **for package management and project scripts**. For globally installed CLIs (via `bun add -g`), use direct bare commands only.
2. **Direct Global CLIs (absolute rule for all agents)**: `turbo`, `oxlint`, `oxfmt`, `skills` etc. MUST be called directly (`turbo run ...`, `oxlint .`, `oxfmt .`, `skills find ...`). NEVER `bunx turbo`, `bunx skills@latest`, `bun turbo`, `npx ...`. This rule applies to Antigravity, Grok, Gemini, Claude and all agents. Link to this file.
3. **Linting**: NEVER use ESLint or Prettier. ALWAYS use `oxlint` and `oxfmt` directly (never via bunx).
4. **Data**: ALL volatile JSON and data files MUST be written to `${WINCLEAN_ROOT}/var/json/` (default `<repo>\var\json\`). Read `WINCLEAN_ROOT` from the environment; fall back to `<repo>` only when unset.
5. **Runtime boundary**: Windows capability code belongs to the Rust owner
   declared in `docs/reference/os/WINCLEAN-RUST-CONVERGENCE.md`; do not add .NET, NuGet,
   DLL-loading, or second-MCP dependencies.
6. **Python**: `uv` / `uvx` only — never `pip` / `poetry` / `virtualenv`. Requires Python 3.14.
7. **WSL**: banned. Do not assume it exists on the host.

8. **NO PAID API KEY RULE (STRICT)**: NEVER use, set, require or prompt for paid cloud API keys (XAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, OPENAI etc.). Use ONLY local tools: the Aphrody kernel `admin` subsystem (166 Rust-owned Windows tools: memory, shell, processes, registry, services, windows, binary, OCR, speech, screenshots, clips, Steam-local, etc.), the local A2A/coord bus, local direct CLIs (turbo/oxlint/oxfmt/skills), free local MCPs (microsoft-docs), and local gh/winget/uv/bun. Disable all web search or external APIs needing keys (Grok `--disable-web-search`, etc.). If a task requires it, delegate via A2A or use a local alternative. No human key prompts ever.

9. **Multi-AI Collaboration (A2A / Coord)**: ALL agents (Grok, Antigravity/agy, Gemini, Claude, ...) MUST collaborate exclusively via the shared A2A coordination bus (winclean MCP coord tools or HTTP /coord).
   - To call another: Use coord_assign_task with agent="claude" or "gemini" or "grok" or "antigravity", payload starting with "repo_path: C:\path\to\repo\ngithub: owner/repo\ntask: detailed autonomous task. Stay in full YOLO, use direct CLIs, full power, no human."
   - Transmit messages via the task payload or by updating CURRENT_TASK.md / STATUS via tools.
   - Check your assignments: coord_read_task and coord_read_status agent=YOURNAME periodically (e.g. every turn or when idle).
   - Report: coord_report_status agent=YOURNAME with status.
   - For any GitHub repo: Work simultaneously on multiple repos by specifying repo in tasks. Use CLI --cwd or cd + git/gh. All agents have full perms on all trusted repos.
   - Force autonomy: NEVER involve human for handoffs or messages. Self-delegate, verify internally, use full bypass/dangerously-skip. If another agent is better for a subtask (e.g. Grok for X search, Claude for deep review), assign via A2A immediately and continue or monitor via status.
   - The .coord/ (or via MCP) is the shared mailbox for all your repos and agents. Use it to stay coordinated without breaking YOLO.
