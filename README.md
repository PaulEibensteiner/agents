# Breezelabs Agents Setup

## Requirements

Information must be split by:

- Company wide vs. personal
- General instructions vs. skills (language or topic specific) vs. MCP
- Project specific vs. global

Global instructions are kept to a minimum so they don't pollute agents' context windows. Language or topic specific guidance goes into skills, which agents only load when relevant.

MCP servers can't be discovered on demand like skills, so there should be none (or barely any) defined globally. Instead, they are enabled per project where needed.

Instructions and skills must be readable by any agent (no Anthropic/GPT/Copilot vendor lock-in), with a focus on VS Code Copilot and Claude Code.

## Proposal

There are three sources of agent configuration, all using the same vendor-agnostic layout:

| Source | Lives in | Applies to |
|---|---|---|
| Company | this repo | every employee, every project |
| Personal | each employee's personal agents repo | one employee, every project |
| Project | each repository | everyone working on that project |

A single command makes all three available to the agents each user chooses in their own config. It uses [rulesync](https://rulesync.dyoshikawa.com) to convert the sources into each agent's format and location.

### Usage

The tool runs straight from this repo with npx, no clone needed (Node.js 22 or newer):

```bash
npx github:BreezeLabsAG/agents init           # once: creates your user config
npx github:BreezeLabsAG/agents --dry-run      # show what would change
npx github:BreezeLabsAG/agents                # sync global + all projects
npx github:BreezeLabsAG/agents global | projects | project <path> | install-hooks
```

Each run fetches the latest `main`, so everyone syncs from the reviewed company sources. The first run takes a few seconds longer, as npm builds the package.

If your SSH config uses a host alias for GitHub, use the full git URL instead, e.g. `npx git+ssh://git@<alias>/BreezeLabsAG/agents.git`.

### Configuration

All configuration is JSONC, validated by `config.schema.json`:

- `agents.config.jsonc` in this repo holds the company settings: the global sources folder, the generated-file marker and the git hooks.
- `~/.config/breezelabs-agents/config.jsonc` holds your own settings: the path of your personal repo, the folder containing your project repos, and which agents and features to generate globally and for projects. `init` creates it with Claude Code and VS Code Copilot enabled; remove the agents you don't use. Any company key can be overridden here as well.

### Vendor Agnostic Layout

All sources use the rulesync source layout:

```
.rulesync/
  rules/
    <name>.md             # instructions; root: true for always-loaded ones, globs for path-scoped ones
  skills/
    <skill-name>/
      SKILL.md            # loaded by the agent only when relevant
      ...                 # optional supporting files
  mcp.jsonc               # MCP servers, ideally only in projects
rulesync.jsonc            # optional: external sources, or a project's own agents and features
```

In project repos this sits at the repo root. The company and personal repos keep their global sources in a `global/` folder (set by `globalDir` in `agents.config.jsonc`), so their own root `.rulesync/` stays project-level. For example, the rulesync skill for maintaining this repo is only installed for this repo, not for everyone:

```
agents/                   # or the personal repo
  global/
    .rulesync/            # synced to every agent globally
    rulesync.jsonc
  .rulesync/              # project-level, only for working on this repo
```

The file formats are described in the [rulesync documentation](https://rulesync.dyoshikawa.com/reference/file-formats). Rules marked `root: true` in the company and personal repos are combined into one instructions file per agent.

External rules and skills (e.g. from `anthropics/skills`) are declared under `sources` in the `rulesync.jsonc` next to the `.rulesync/` folder, pinned to a commit in `rulesync.lock`, and installed automatically on every sync. Add one by running `npx rulesync@24.0.0 add <owner/repo> --skills <name>` in that folder.

### The Sync Command

The sync runs two stages:

1. **Global:** company + personal `global/` sources go into the user-level agent folders (e.g. `~/.claude/`, `~/.copilot/`).
2. **Projects:** each repo directly inside your repos folder that has a `.rulesync/` folder gets its project-level agent files (e.g. `CLAUDE.md`, `.github/copilot-instructions.md`).

Every stage first does a dry run and lists each change as `new`, `update`, `remove (stale)`, or `OVERWRITE` / `DELETE (not generated)`. Then it applies them.

Supported operating systems: Linux, macOS and WSL. In WSL, VS Code windows connected to WSL read the Linux home folder, the same as Claude Code. Writing to the Windows home folder for VS Code windows opened on Windows folders isn't supported for now.

### Generated Files

Every source rule and `SKILL.md` must contain the marker defined in `agents.config.jsonc`; the sync stops with an error if one doesn't. Generated files inherit the marker, which tells them apart from hand-written files. External rules and skills get the marker appended on installation.

- Generated files are overwritten on every run without notice.
- Generated files whose source no longer exists are deleted.
- Hand-written files that would be overwritten or deleted are listed, and are only changed after confirmation (or with `--yes`). Without a terminal (e.g. in a git hook), that stage is skipped with a warning. This is intended: all instructions should be tracked in git (company, personal or project repo), so the sync tells you about untracked ones and you move them into the right repo.
- MCP servers are JSON and can't carry a marker. rulesync replaces the MCP servers in the agent's config (e.g. `~/.claude.json`) and keeps all other settings, so every MCP server has to be defined in a source.

### Project Stage

Project-specific instructions, skills and MCP servers are defined in the respective repository's `.rulesync/` folder and reviewed in its PRs. A project can override the company's default agents and features with its own `rulesync.jsonc`.

The project stage can be installed as git hooks (on checkout, merge and commit) so the generated files stay up to date. If the hooks are installed, a manual sync skips that repo.

### Personal Repo

Same layout as this repo, synced after the company sources. Conflicts or precedence between company and personal instructions aren't resolved, as agents handle this differently. Everyone is responsible for not keeping instructions that conflict with the company ones and objecting to merges into this repository, if such conflicts would be introduced by new company instructions.

### Review Process

The main branch of this repo is only merged after a joint review, where we agree on the proposed changes.

## Open Questions

- Whether generated files inside project repos are committed (so cloud agents and teammates without the sync see them) or gitignored.
- VS Code reads both `~/.claude/` and `~/.copilot/` instructions, so it may load the global instructions twice.
- Whether VS Code windows opened on Windows folders need the configuration in the Windows home folder as well.

## Restrictions

- VSCode chat does not allow global mcp synchronization (yet).

## Development

```bash
npm install            # installs dependencies and builds dist/
node dist/cli.js --dry-run
```

Running from a local clone syncs the company sources of that clone, which is useful for testing changes before they are merged.
