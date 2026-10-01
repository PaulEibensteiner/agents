/**
 * Loads the configuration: the company defaults in agents.config.jsonc
 * (shipped with this package), overridden key by key by the user's
 * ~/.config/breezelabs-agents/config.jsonc. Both follow config.schema.json.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { ALL_FEATURES, ALL_TOOL_TARGETS, type Feature, type ToolTarget } from "rulesync";

/** Maps rulesync targets (agents) to the features generated for them. */
export type TargetFeatures = Partial<Record<ToolTarget, Feature[]>>;

/** The merged configuration. */
export interface Config {
  personalRepo?: string;
  reposRoot?: string;
  /** Folder in the company and personal repos holding the global rulesync project. */
  globalDir: string;
  global: TargetFeatures;
  projects: TargetFeatures;
  marker: string;
  gitHooks: string[];
}

/** Root of this package, which is the company repo: its global sources live in <globalDir>/.rulesync/. */
export const COMPANY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const COMPANY_CONFIG = join(COMPANY_DIR, "agents.config.jsonc");
const SCHEMA = join(COMPANY_DIR, "config.schema.json");
const KNOWN_KEYS = new Set(["$schema", "personalRepo", "reposRoot", "globalDir", "global", "projects", "marker", "gitHooks"]);

const USER_CONFIG_TEMPLATE = `// Your personal breezelabs-agents configuration. Any key set here overrides
// the company settings in agents.config.jsonc. See config.schema.json.
{
  "$schema": "./config.schema.json",

  // Your personal agents repo; its global/.rulesync/ folder is synced after the company one.
  "personalRepo": "~/repos/agents-personal",

  // Folder containing your project repos. Every repo directly inside it with a
  // .rulesync/ folder is synced.
  "reposRoot": "~/repos",

  // The agents you use (rulesync targets) and what to generate for them in
  // your user-level folders. Remove the ones you don't use.
  // copilot has no user-level MCP. VS Code's Agent Host reads the Copilot CLI
  // file (~/.copilot/mcp-config.json) instead, so copilotcli is used for MCP only.
  "global": {
    "claudecode": ["rules", "skills", "mcp"],
    "copilot": ["rules", "skills"],
    "copilotcli": ["mcp"],
  },

  // The same for project repos without their own rulesync.jsonc.
  // claudecode writes .mcp.json, copilot writes .vscode/mcp.json.
  "projects": {
    "claudecode": ["rules", "skills", "mcp"],
    "copilot": ["rules", "skills", "mcp"],
  },
}
`;

export function userConfigDir(): string {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "breezelabs-agents");
}

export function userConfigPath(): string {
  return join(userConfigDir(), "config.jsonc");
}

export function expandHome(path: string): string {
  return path.replace(/^~(?=$|\/)/, homedir());
}

export function readJsonc(path: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const value: unknown = parse(readFileSync(path, "utf8"), errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const { error, offset } = errors[0];
    throw new Error(`${path}: invalid JSONC (${printParseErrorCode(error)} at offset ${offset})`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function validateTargets(value: unknown, key: string): TargetFeatures {
  if (value === undefined) {
    throw new Error(`config: "${key}" is not set; add the agents you use to ${userConfigPath()} (see \`init\`)`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`config: "${key}" must map targets to feature lists`);
  }
  for (const [target, features] of Object.entries(value)) {
    if (!(ALL_TOOL_TARGETS as readonly string[]).includes(target)) {
      throw new Error(`config: unknown rulesync target "${target}" in "${key}"`);
    }
    if (!Array.isArray(features) || features.some((f) => !(ALL_FEATURES as readonly string[]).includes(f))) {
      throw new Error(`config: "${key}.${target}" must be a list of: ${ALL_FEATURES.join(", ")}`);
    }
  }
  return value as TargetFeatures;
}

function optionalString(value: unknown, key: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`config: "${key}" must be a string`);
  return expandHome(value);
}

/** Reads and validates the company defaults merged with the user's config. */
export function loadConfig(): Config {
  const user = existsSync(userConfigPath()) ? readJsonc(userConfigPath()) : {};
  const merged = { ...readJsonc(COMPANY_CONFIG), ...user };
  for (const key of Object.keys(merged)) {
    if (!KNOWN_KEYS.has(key)) throw new Error(`config: unknown key "${key}"`);
  }
  const { globalDir, marker, gitHooks } = merged;
  if (typeof globalDir !== "string" || globalDir.length === 0) throw new Error(`config: "globalDir" must be a non-empty string`);
  if (typeof marker !== "string" || marker.length === 0) throw new Error(`config: "marker" must be a non-empty string`);
  if (!Array.isArray(gitHooks) || gitHooks.some((h) => typeof h !== "string")) {
    throw new Error(`config: "gitHooks" must be a list of hook names`);
  }
  return {
    personalRepo: optionalString(merged.personalRepo, "personalRepo"),
    reposRoot: optionalString(merged.reposRoot, "reposRoot"),
    globalDir,
    global: validateTargets(merged.global, "global"),
    projects: validateTargets(merged.projects, "projects"),
    marker,
    gitHooks,
  };
}

/**
 * Copies the schema next to the user config, so editors can validate it even
 * though this repo is private. Refreshed on every run.
 */
export function refreshUserSchema(): void {
  mkdirSync(userConfigDir(), { recursive: true });
  copyFileSync(SCHEMA, join(userConfigDir(), "config.schema.json"));
}

/** Creates the user config from a template. Returns false if it already exists. */
export function initUserConfig(): boolean {
  refreshUserSchema();
  if (existsSync(userConfigPath())) return false;
  writeFileSync(userConfigPath(), USER_CONFIG_TEMPLATE);
  return true;
}
