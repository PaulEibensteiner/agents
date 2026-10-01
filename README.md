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
| Personal | each employee's `agents_personal` repo | one employee, every project |
| Project | each repository | everyone working on that project |

A single command (`sync`) makes all three available to the agents listed in `vendor_formats`, for the current OS.

### Vendor Agnostic Layout

Company and personal repos share this layout:

```
instructions/
  AGENTS.md              # global instructions, minimal
skills/
  <skill-name>/
    SKILL.md             # loaded by the agent only when relevant
    ...                  # optional supporting files
mcp/                     # global MCP servers, ideally empty
```

Repositories use the same layout, with `AGENTS.md` at the repo root:

```
<repo>/
  AGENTS.md
  .agents/
    skills/<skill-name>/SKILL.md
    mcp/
```

The exact file formats inside `skills/` and `mcp/` are still to be defined.

### The `sync` Command

`sync` runs three stages: company, personal, project (for all repos under `repos_root`). For each vendor in `vendor_formats` it makes the sources discoverable, preferring the least invasive option:

1. **Native:** the vendor already reads the source (e.g. `AGENTS.md`). Nothing to do.
2. **Import:** the vendor's entry file (e.g. a user-level instructions file) imports the source. `sync` makes sure this entry file exists and contains the import.
3. **Link:** the vendor folder symlinks to the source folder.
4. **Copy:** the source is copied and converted into the vendor's format. Used only if 1–3 aren't possible.
5. **Vendor CLI:** configuration the vendor manages itself (e.g. MCP servers in Claude Code) is applied via its CLI, never by editing its files.

Supported OS categories so far: Linux, macOS, Windows Subsystem for Linux (WSL). WSL is treated separately because some tools run on the Linux side while others (e.g. VS Code) keep their user configuration on the Windows side.

### Generated Files

Every file that `sync` writes carries a marker identifying it as generated, stored in the file itself (a header comment or a YAML frontmatter entry, depending on the format).

- Generated files are overwritten on every run without notice.
- Generated files whose source no longer exists are deleted.
- Any non-generated instruction, skill or MCP file found in a vendor location raises an error. This is intended: all instructions should be tracked in git (company, personal or project repo), so `sync` tells you about untracked ones and you move them into the right repo. **This is disruptive to current workflow, so we need to be sure we want this before everyone implements it** 

### Project Stage

Project-specific instructions, skills and MCP servers are defined in the respective repository and reviewed in its PRs. `sync` only touches a repo if a vendor needs a conversion (a step 2–5 above).

The project stage can be installed as a git hook (on checkout, merge and commit) so conversions stay up to date. If the hook is installed, a manual `sync` skips this stage.

### Personal Repo

Same layout as this repo, synced after the company stage. `sync` doesn't resolve conflicts or precedence between company and personal instructions, as vendors handle this differently. Everyone is responsible for not keeping instructions that conflict with the company ones and objecting to merges into this repository, if such conflicts would be introduced by new company instructions.

### Review Process

The main branch of this repo is only merged after a joint review, where we agree on the proposed changes.

