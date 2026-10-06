# Project Guidance

<!-- dev-harness:core:start -->
## Core execution principles

- Prioritize real outcomes and value over process completeness.
- Match verification effort to the risk of the change.
- Stop verifying once the main path and material risks are covered, unless new concrete failure evidence appears.
- When a core must-have fails, seek a simpler practical pivot instead of merely recording a limitation.
- Avoid refactors, documentation, audits, and test expansion unrelated to the current objective.
- Preserve existing work and use safe Git practices; avoid unnecessary destructive operations.
<!-- dev-harness:core:end -->

<!-- dev-harness:profile:start -->
## Software profile

Objective: deliver a strong real user/product outcome with sufficient maintainability.

Default priority: user path and product experience > correctness/stability > maintainability > formal process, test counts, and audit completeness. This does not license incorrect or unsafe behavior.

- Make the real user path work before pursuing architectural perfection.
- Product and UX quality are part of completion; inspect actual experience when relevant.
- Use minimum sufficient verification for ordinary UI and features.
- Raise verification for state machines, migrations, atomic writes, security, destructive operations, and other high-risk logic.
- Avoid premature refactoring; improve structure when it serves the current outcome.
- Do not let verification routinely dominate implementation and product polish; deeper checks need a concrete risk or failure to resolve.
<!-- dev-harness:profile:end -->

## Project-specific invariants

### Product and scope

- YD / Your Day / DayHub is a local-first Windows hub for courses, schedules, tasks, reminders, person-aware status and a low-interruption companion. Project priority: stability > data correctness > clear domain modeling > maintainability > coherent visual experience; this takes precedence over the generic Software Profile default. Never trade these properties for a quick demo.
- Core local schedules, tasks and reminders remain usable without AI, QQ or cloud services.

- Consult docs/PROJECT_CONTEXT.md for current architecture and active stage restrictions before relevant edits; use docs/DECISIONS.md for consequential rationale.

- Follow the current user request, then more-specific AGENTS.md / AGENTS.override.md, then this file. Before non-trivial edits inspect Git status, branch, relevant commits, affected code and its test baseline. Never reset, stash, overwrite user work, rebase, merge, switch branches or rewrite history without explicit authorization.

- Never commit generated output, caches, logs, private AppData, private message data, credentials, secrets or test data; committed migration fixtures remain intentional test inputs.

- Never weaken tests or assertions to manufacture a pass; choose the existing verifier that covers the actual change.

### Verification and delivery

- TypeScript changes affecting types require typecheck. StateEngine, schedule/routine/manual derivation, time boundaries, persistence, migrations, main/preload/IPC, profiles, avatar runtime/fallback, important conversions and cross-module refactors require typecheck and relevant targeted checks; use npm test when multiple domain modules may be affected. Time changes need boundary tests.
- Releases, migrations, large architecture changes, multi-domain changes, explicit full acceptance and stable merge/tag preparation require the full relevant gate: tests/typecheck and applicable build, Electron, visual or installer verification. Ordinary docs edits need diff review; ordinary local changes need only their relevant check. Do not run unrelated gates.

- Communicate in Chinese when the user does. For non-trivial work give concise progress, evidence, next action and blockers; report only executed checks, not raw reasoning or long logs.

### Session continuation

- AGENTS holds durable rules; PROJECT_CONTEXT holds changing facts; DECISIONS holds consequential rationale; HANDOFF holds current continuation. Git records committed history. Do not mix them.
- Create/refresh HANDOFF only for an explicit request, a long session ending, unfinished work pausing, a session/model switch or complex continuation needs. Do not update it mechanically for a completed small task.
- Before writing a handoff inspect branch, HEAD/relevant commits, status, diff, task code and executed verification. Record objective, completed work, exact stopping state, ordered next actions, task decisions, pitfalls and PASS / FAIL / pending; never mark planned work complete or old checks current without evidence.
- On continuation read root and scoped AGENTS, HANDOFF, named code and Git state. Current instructions and repository truth override stale handoff text. Preserve valid decisions and verification without rerunning unchanged checks. Replace stale plans/blockers instead of appending history; keep handoffs concise, normally under about 100 lines.

### Domain laws

- Keep domain rules deterministic, pure and testable; separate rendering, IPC, storage, time calculation and state selection. Extend the existing model instead of adding a parallel state system.
- CurrentState is authoritative: manual > schedule > routine > idle. DailyException modifies a schedule candidate; it is not a competing source. UI/companion may project or decorate state but never override it.
- Solo and Together support generalized self/companion profiles; never assume a fixed pair or derive identity from array position.
- Time uses Asia/Shanghai (UTC+8), including cross-midnight/date boundaries, exceptions and left-closed/right-open intervals.
- Each person owns their routine. A cross-midnight routine belongs to its start day and remains one editable interval; equal start/end is invalid rather than a 24-hour rule. Occurrences are derived, not persisted facts, and overlapping routines must resolve deterministically.
- Separate avatar definition, registered assets, runtime loading, state mapping and rendering. Use registered production packs and explicit fallbacks; never silently substitute emoji, retired avatars, random assets or demo placeholders.

### Data, security and integrations

- Real data takes priority: never seed a real empty database or contaminate it with demo data. Read the schema before persistent-format changes; use explicit compatible migrations and verification, preserving data. Do not silently migrate large datasets or alter user preferences.
- Preserve Electron main/preload/IPC security boundaries. Treat model output and external messages as untrusted advisory input; retain source, timestamp, original content, parsed result and errors where stored. Consequential schedules/records need review, correction and user confirmation; inferred data never overrides manual facts. API failure must not pretend success.
- Future AI/message/integration work must preserve the local-first, user-confirmed model. Personal QQ or other unofficial integrations remain experimental until authentication, permissions, retention and reliability are demonstrated; do not promise complete access, durable login, message history or unimplemented production capabilities without evidence.
- Do not alter global proxy, DNS, routing, certificates, firewall, registry, persistent environment variables or other system settings without explicit permission; prefer scoped reversible process settings.
- Add dependencies only for a clear need after explicit impact review; prefer existing capabilities and explain dependency, bundle, license and security impact in the diff.

### Product and design principles

- Summary surfaces (daily/status/course cards, Dock/Tip/Mini, list rows) prioritize state/time/title/next meaningful item and useful optional location/status. Put provenance, parser/source explanations, implementation/storage/migration notes and long confidence text in details/tooltips/inspectors; show a very short source in summaries only when it affects the current decision.
- One semantic role per line: primary state/title, status note, next item. Do not combine source/end/next/time/title into prose, repeat next/end prefixes conveyed by position, or add filler.
- Avoid synonymous nested headings and repeated explanations; keep controls with the title they govern. Solo mode must not show meaningless companion comparison choices. Settings present choices, not implementation architecture.
- Omit absent optional location/notes/metadata unless absence blocks action, matters to the decision or the screen exists to fill it; distinguish an empty state from a missing field.
- Preserve provenance in details/history/audit trails. Keep repeated cards scannable by time/title/state, then short useful context; do not repeat source explanations on every card.
- Choice language: navigation uses tabs; booleans switches; 2-4 values independent lightweight chips; larger visual choices cards; many text options dropdown/list. Avoid glued gray-track segmented settings; use natural gaps, low-saturation surfaces, fine borders and clear selected/hover/normal states, without heavy shadows or saturated fills. Reuse tokens/components for equivalent enum choices.
- Hierarchy follows the user task, not code nesting. Supporting copy and avatar previews must not outrank the primary choice. Prefer omission or details over persistent explanation when interaction is self-evident.
- Presentation cleanup must not rewrite stored data, change CurrentState/event types, discard provenance, alter migrations or fake missing fields. Use projection, conditional rendering, hierarchy/copy/layout; report an underlying domain-data bug separately rather than hiding it.

- Keep YD quiet, restrained, readable and locally trustworthy, using existing visual conventions; avoid dashboard/SaaS styling, heavy glass/gradients, gamification and decorative motion that harms clarity. Companion/orb stays low-interruption, geometrically stable, draggable and predictable on hover; drag cleanup removes transient tooltip/overlay/hover state. Production art is approved or an explicitly labeled development placeholder.

### Changes and Git delivery

- Diagnose bugs through reproduction, real state, trigger chain, root cause, regression coverage and neighboring behavior; do not hide them with timeouts/cosmetics. Refactors need a concrete benefit and preserve observable behavior unless requested. Before deleting assets, migrations, preload or Electron resources inspect imports, dynamic loading and packaging references.
- Change application version only for an explicit version request, a defined release or requested installer; keep package/about/packaging sources consistent. Do not restore retired behavior silently; define an explicit fallback policy.
- Verify proportionately, review diff, then commit a completed independently verifiable ordinary task unless the user says not to. Stage only task files (AGENTS is tracked); use narrow Conventional Commit messages. Never amend or force-push without explicit approval.

- Ordinary final reports cover completion, executed PASS/FAIL checks and Git branch/commit/working tree. Name preserved user changes. Use more detail for blockers/releases; release reports include app version, installer path/type, build result, checksum and packaged smoke evidence.
