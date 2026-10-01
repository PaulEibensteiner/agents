/**
 * Git hooks that keep a project repo's generated agent configuration in sync
 * on checkout, merge and commit.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAbsolute, join } from "node:path";
import type { Config } from "./config.js";

const HOOK_MARKER = "# breezelabs-agents hook";
const CLI = fileURLToPath(new URL("./cli.js", import.meta.url));

function hooksDir(repo: string): string | undefined {
  try {
    const dir = execFileSync("git", ["-C", repo, "rev-parse", "--git-path", "hooks"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return isAbsolute(dir) ? dir : join(repo, dir);
  } catch {
    return undefined;
  }
}

function isOurs(file: string): boolean {
  return existsSync(file) && readFileSync(file, "utf8").includes(HOOK_MARKER);
}

/** True if the first configured hook in `repo` was installed by this tool. */
export function hooksInstalled(repo: string, config: Config): boolean {
  const dir = hooksDir(repo);
  return dir !== undefined && config.gitHooks.length > 0 && isOurs(join(dir, config.gitHooks[0]));
}

/**
 * The hook calls this package's CLI by its absolute path, since running it
 * through npx on every commit would be too slow.
 */
function hookScript(): string {
  return `#!/bin/sh
${HOOK_MARKER}
# Keeps the agent configuration generated from .rulesync/ up to date.
cli="${CLI}"
if [ -f "$cli" ]; then
  node "$cli" project "$(git rev-parse --show-toplevel)" --hook || true
else
  echo "breezelabs-agents: $cli not found. Re-install the hooks: npx github:BreezeLabsAG/agents install-hooks" >&2
fi
`;
}

/** Installs the hooks in `repo`, never overwriting hooks this tool didn't write. */
export function installHooks(repo: string, config: Config, dryRun: boolean): void {
  const dir = hooksDir(repo);
  if (!dir) {
    console.warn(`warning: ${repo} is not a git repo, skipping`);
    return;
  }
  mkdirSync(dir, { recursive: true });
  for (const name of config.gitHooks) {
    const file = join(dir, name);
    if (existsSync(file) && !isOurs(file)) {
      console.warn(`warning: ${file} already exists and was not installed by breezelabs-agents, skipping`);
      continue;
    }
    if (dryRun) {
      console.log(`  would install ${file}`);
      continue;
    }
    writeFileSync(file, hookScript());
    chmodSync(file, 0o755);
    console.log(`  installed ${file}`);
  }
}
