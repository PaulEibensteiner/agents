/**
 * The sync stages. Each stage is a set of rulesync generate runs: first all
 * runs are dry-run to list the changes, then, if no hand-written files are
 * affected (or the user confirms), they are run for real with delete enabled.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { generate, type Feature, type GenerateOptions, type ToolTarget } from "rulesync";
import { COMPANY_DIR, readJsonc, type Config, type TargetFeatures } from "./config.js";
import { hooksInstalled } from "./hooks.js";

/** Command-line options that affect every stage. */
export interface SyncOptions {
  dryRun: boolean;
  yes: boolean;
  /** Called from a git hook: never prompt. */
  hook: boolean;
}

/** One rulesync generate call, run with `cwd` as working directory. */
interface Run {
  cwd: string;
  options: GenerateOptions;
}

/** A change the dry run reported, one per file or per skill folder. */
interface Change {
  path: string;
  label: string;
  handwritten: boolean;
}

const RULESYNC_CLI = join(dirname(createRequire(import.meta.url).resolve("rulesync")), "cli", "index.js");

/** Runs the bundled rulesync CLI, for commands the programmatic API lacks (install). */
function rulesyncCli(args: string[], cwd: string): void {
  execFileSync(process.execPath, [RULESYNC_CLI, ...args], { cwd, stdio: "inherit" });
}

/** Runs `fn` with `dir` as working directory; rulesync resolves outputs and configs from it. */
async function inDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
}

/** Lists files below `dir` as paths relative to it. */
function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => statSync(join(dir, f)).isFile());
}

function isSource(relative: string): boolean {
  return (relative.startsWith(`rules${sep}`) && relative.endsWith(".md")) ||
    (relative.startsWith(`skills${sep}`) && basename(relative) === "SKILL.md");
}

/**
 * Prepares the .rulesync/ source tree of a rulesync project (a repo, or the
 * global folder inside the company/personal repo): installs external rules and
 * skills (pinned in rulesync.lock), appends the marker to them since they
 * can't carry it upstream, and fails if any source lacks the marker.
 */
function prepareSources(root: string, config: Config, options: SyncOptions): void {
  const tree = join(root, ".rulesync");
  if (existsSync(join(root, "rulesync.lock")) && !options.dryRun) {
    rulesyncCli(["install", "--frozen", "--silent"], root);
  }
  const sources = listFiles(tree).filter(isSource);
  const missing: string[] = [];
  for (const relative of sources) {
    const file = join(tree, relative);
    if (readFileSync(file, "utf8").includes(config.marker)) continue;
    if (relative.includes(`${sep}.curated${sep}`)) {
      appendFileSync(file, `\n${config.marker}\n`);
    } else {
      missing.push(file);
    }
  }
  if (missing.length > 0) {
    throw new Error(`these sources lack the marker:\n  ${missing.join("\n  ")}\nAppend this line to each:\n  ${config.marker}`);
  }
}

/** Without an mcp.jsonc source, rulesync reports MCP files as changed on every run. */
function hasMcpSource(roots: string[]): boolean {
  return roots.some((root) => existsSync(join(root, "mcp.jsonc")) || existsSync(join(root, "mcp.json")));
}

/** Builds one run per target, skipping MCP when there is no MCP source. */
function runsPerTarget(cwd: string, targets: TargetFeatures, base: GenerateOptions): Run[] {
  const roots = base.inputRoots ?? [join(cwd, ".rulesync")];
  const withMcp = hasMcpSource(roots);
  return Object.entries(targets)
    .map(([target, features]) => ({
      cwd,
      options: {
        ...base,
        targets: [target as ToolTarget],
        features: (features as Feature[]).filter((f) => withMcp || f !== "mcp"),
      },
    }))
    .filter((run) => run.options.features.length > 0);
}

/**
 * A path counts as generated if it carries the marker. A skill is judged by its
 * SKILL.md, the only file that carries the marker. MCP configs are JSON, which
 * rulesync merges into the agent's own config, so they can't be marked.
 */
function isGenerated(path: string, marker: string): boolean {
  if (/\.jsonc?$/.test(path)) return true;
  const file = statSync(path).isDirectory() ? join(path, "SKILL.md") : path;
  try {
    return readFileSync(file, "utf8").includes(marker);
  } catch {
    return false;
  }
}

/**
 * Dry-runs a rulesync generate and returns the changes it would make.
 * The API result lists written files but not deletions, so the dry-run log
 * lines (printed via console.log) are captured instead.
 */
async function plan(run: Run, marker: string): Promise<Change[]> {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    const result = await inDir(run.cwd, () => generate({ ...run.options, delete: true, dryRun: true, silent: false }));
    if (result.sourceLoadFailed) throw new Error(`rulesync could not read sources for: ${result.sourceLoadFailedFeatures.join(", ")}`);
  } finally {
    console.log = log;
  }

  const changes: Change[] = [];
  for (const line of lines) {
    const match = line.match(/Would (write|delete directory|delete): "?(.+?)"?$/);
    if (!match) continue;
    const action = match[1] === "write" ? "write" : "delete";
    // Files inside an agent's skill folder (e.g. ~/.claude/skills/uv/...) count as the skill.
    const path = match[2].match(/^(.*\/\.[^/]+\/skills\/[^/]+)\//)?.[1] ?? match[2];
    if (changes.some((c) => c.path === path)) continue;
    if (!existsSync(path)) {
      changes.push({ path, label: "new", handwritten: false });
    } else if (isGenerated(path, marker)) {
      changes.push({ path, label: action === "write" ? "update" : "remove (stale)", handwritten: false });
    } else {
      changes.push({ path, label: action === "write" ? "OVERWRITE (not generated)" : "DELETE (not generated)", handwritten: true });
    }
  }
  return changes;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

/** Plans, confirms and applies one stage. */
async function runStage(label: string, runs: Run[], config: Config, options: SyncOptions): Promise<void> {
  console.log(`== ${label}`);
  const changes = (await sequential(runs.map((run) => () => plan(run, config.marker)))).flat();
  if (changes.length === 0) {
    console.log("  up to date");
    return;
  }
  for (const change of changes) console.log(`  ${change.label.padEnd(26)} ${change.path}`);
  if (options.dryRun) return;

  if (changes.some((c) => c.handwritten) && !options.yes) {
    if (options.hook || !process.stdin.isTTY) {
      console.warn(`warning: skipped ${label}: it would overwrite or delete files that are not generated (marked above).`);
      console.warn("Move their content into a .rulesync/ source, or run with --yes.");
      return;
    }
    if (!(await confirm("Overwrite/delete the files marked as not generated?"))) {
      console.log("  skipped");
      return;
    }
  }
  for (const run of runs) {
    const result = await inDir(run.cwd, () => generate({ ...run.options, delete: true, silent: true }));
    if (result.sourceLoadFailed) throw new Error(`rulesync could not read sources for: ${result.sourceLoadFailedFeatures.join(", ")}`);
  }
  console.log("  done");
}

/** Runs async tasks one after another; rulesync runs change the working directory. */
async function sequential<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = [];
  for (const task of tasks) results.push(await task());
  return results;
}

/**
 * Syncs company + personal global sources (<globalDir>/.rulesync/ in each
 * repo) into the user-level agent folders. The repos' own root .rulesync/
 * folders are project-level and handled by the project stage.
 */
export async function syncGlobal(config: Config, options: SyncOptions): Promise<void> {
  const company = join(COMPANY_DIR, config.globalDir);
  const roots = [join(company, ".rulesync")];
  prepareSources(company, config, options);
  const personal = config.personalRepo && join(config.personalRepo, config.globalDir);
  if (personal && existsSync(join(personal, ".rulesync"))) {
    prepareSources(personal, config, options);
    roots.push(join(personal, ".rulesync"));
  } else {
    console.warn(`warning: no personal sources found${personal ? ` at ${personal}/.rulesync` : " (personalRepo not set)"}`);
  }
  const runs = runsPerTarget(company, config.global, { global: true, inputRoots: roots });
  await runStage("global", runs, config, options);
}

/** Syncs a single project repo from its .rulesync/ folder. */
export async function syncProject(path: string, config: Config, options: SyncOptions): Promise<void> {
  const repo = realpathSync(path);
  const name = `project ${basename(repo)}`;
  if (!existsSync(join(repo, ".rulesync"))) {
    console.log(`== ${name}: no .rulesync/ folder, nothing to do`);
    return;
  }
  prepareSources(repo, config, options);
  // A project's own rulesync.jsonc decides its agents and features if it sets
  // targets; one that only declares external sources doesn't.
  const projectConfig = join(repo, "rulesync.jsonc");
  const runs = existsSync(projectConfig) && readJsonc(projectConfig).targets !== undefined
    ? [{ cwd: repo, options: {} }]
    : runsPerTarget(repo, config.projects, {});
  await runStage(name, runs, config, options);
}

/** Lists repos directly inside reposRoot that have a .rulesync/ folder. */
export function projectRepos(config: Config): string[] {
  if (!config.reposRoot) throw new Error(`config: "reposRoot" is not set`);
  return readdirSync(config.reposRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => realpathSync(join(config.reposRoot!, entry.name)))
    .filter((repo) => existsSync(join(repo, ".rulesync")));
}

/** Syncs every project repo, except those kept in sync by git hooks. */
export async function syncProjects(config: Config, options: SyncOptions): Promise<void> {
  for (const repo of projectRepos(config)) {
    if (hooksInstalled(repo, config)) {
      console.log(`== project ${basename(repo)}: skipped, kept in sync by git hooks`);
      continue;
    }
    await syncProject(repo, config, options);
  }
}
