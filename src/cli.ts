#!/usr/bin/env node
/**
 * Command-line entry point: `npx github:BreezeLabsAG/agents [command] [options]`.
 */
import { initUserConfig, loadConfig, refreshUserSchema, userConfigPath } from "./config.js";
import { installHooks } from "./hooks.js";
import { projectRepos, syncGlobal, syncProject, syncProjects, type SyncOptions } from "./sync.js";

const USAGE = `Usage: npx github:BreezeLabsAG/agents [command] [options]

Commands:
  sync             Sync global and all projects (default)
  global           Sync company + personal sources into the user-level agent folders
  projects         Sync every repo under reposRoot that has a .rulesync/ folder
                   (skips repos whose git hooks keep them in sync)
  project <path>   Sync a single repo
  install-hooks    Install git hooks in all project repos
  init             Create your user config (${userConfigPath()})

Options:
  -n, --dry-run    Only show what would change
  -y, --yes        Overwrite/delete hand-written files without asking
  -h, --help       Show this help

Environment (for testing):
  SYNC_HOME        Home folder to write the global configuration to (default: your home)
`;

async function main(argv: string[]): Promise<void> {
  let command = "sync";
  let projectPath: string | undefined;
  const options: SyncOptions = { dryRun: false, yes: false, hook: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (["sync", "global", "projects", "install-hooks", "init"].includes(arg)) command = arg;
    else if (arg === "project") {
      command = "project";
      projectPath = argv[++i];
      if (!projectPath) throw new Error("project needs a path");
    } else if (arg === "-n" || arg === "--dry-run") options.dryRun = true;
    else if (arg === "-y" || arg === "--yes") options.yes = true;
    else if (arg === "--hook") options.hook = true;
    else if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      return;
    } else throw new Error(`unknown argument "${arg}"\n\n${USAGE}`);
  }

  if (command === "init") {
    console.log(initUserConfig() ? `Created ${userConfigPath()}` : `${userConfigPath()} already exists`);
    return;
  }
  // rulesync writes user-level files below HOME_DIR when it is set.
  if (process.env.SYNC_HOME) process.env.HOME_DIR = process.env.SYNC_HOME;
  refreshUserSchema();
  const config = loadConfig();

  switch (command) {
    case "sync":
      await syncGlobal(config, options);
      await syncProjects(config, options);
      break;
    case "global":
      await syncGlobal(config, options);
      break;
    case "projects":
      await syncProjects(config, options);
      break;
    case "project":
      await syncProject(projectPath!, config, options);
      break;
    case "install-hooks":
      for (const repo of projectRepos(config)) installHooks(repo, config, options.dryRun);
      break;
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
