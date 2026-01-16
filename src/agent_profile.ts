import path from "path";
import fs from "fs";
import { readFileContent } from "./lib/fs";
import { err, ok, Result } from "./lib/error";
import { isNonDefaultToolName, NonDefaultToolName } from "./tools/constants";
import { isArrayOf, isString } from "./lib/utils";

const AGENT_PROFILES_DIR = path.join(__dirname, "../agents");

// Either the name of a local ENV var to capture, or a name and value pair.
export type Env = string | [string, string];

export function isEnv(e: any): e is Env {
  return (
    isString(e) || (Array.isArray(e) && e.length === 2 && e.every(isString))
  );
}

export const PLACEHOLDER_AGENT_PROFILE: AgentProfile = {
  name: "",
  prompt: "",
  description: "",
  tools: [],
  env: [],
};

type Settings = {
  description: string;
  tools: NonDefaultToolName[];
  imageName?: string;
  env: Env[];
};

function isSettings(obj: any): obj is Settings {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "description" in obj &&
    typeof obj.description === "string" &&
    "tools" in obj &&
    isArrayOf(obj.tools, isNonDefaultToolName) &&
    "env" in obj &&
    isArrayOf(obj.env, isEnv)
  );
}

export type AgentProfile = {
  name: string;
  prompt: string;
  dockerFilePath?: string;
} & Settings;

export async function listAgentProfiles(): Promise<
  Result<{ name: string; description: string }[]>
> {
  const profileNames = fs.readdirSync(AGENT_PROFILES_DIR);
  const profileResults = await Promise.all(
    profileNames.map(async (profile) => {
      return {
        name: profile,
        settings: await readSettings(
          path.join(AGENT_PROFILES_DIR, profile, "settings.json"),
        ),
      };
    }),
  );
  const profiles: { name: string; description: string }[] = [];
  for (const { name, settings: res } of profileResults) {
    if (res.isOk()) {
      profiles.push({ name, description: res.value.description });
    } else {
      return err("invalid_parameters_error", "Invalid agent profile(s) found.");
    }
  }
  return ok(profiles);
}

async function readSettings(path: string): Promise<Result<Settings>> {
  if (!fs.existsSync(path)) {
    return err("not_found_error", `Settings file '${path}' not found.`);
  }
  const settingsRes = await readFileContent(path);
  if (settingsRes.isErr()) {
    return settingsRes;
  }

  const settings = JSON.parse(settingsRes.value);
  if (!isSettings(settings)) {
    return err(
      "invalid_parameters_error",
      `Invalid settings.json at '${path}'.`,
    );
  }
  return ok(settings);
}

export async function getAgentProfile(
  name: string,
): Promise<Result<AgentProfile>> {
  const settingsPath = path.join(AGENT_PROFILES_DIR, name, "settings.json");
  const settingsRes = await readSettings(settingsPath);
  if (settingsRes.isErr()) {
    return settingsRes;
  }
  const settings = settingsRes.value;

  const promptRes = await readFileContent(
    path.join(AGENT_PROFILES_DIR, name, "prompt.md"),
  );
  if (promptRes.isErr()) {
    return promptRes;
  }

  let prompt = promptRes.value;
  let dockerFilePath: string | undefined = undefined;

  if (settings.tools.includes("computer") && settings.imageName) {
    const dfPath = path.join(AGENT_PROFILES_DIR, name, "Dockerfile");
    if (fs.existsSync(dfPath)) {
      dockerFilePath = dfPath;
    } else {
      return err(
        "invalid_parameters_error",
        `Expected Dockerfile at ${dfPath} for image ${settings.imageName}.`,
      );
    }
  }

  // Replace {{DOCKERFILE}} placeholder with actual Dockerfile content
  if (prompt.includes("{{DOCKERFILE}}")) {
    if (dockerFilePath) {
      const dockerfileContentRes = await readFileContent(dockerFilePath);
      if (dockerfileContentRes.isErr()) {
        return dockerfileContentRes;
      }
      prompt = prompt.replace(/\{\{DOCKERFILE\}\}/g, dockerfileContentRes.value);
    } else {
      return err(
        "invalid_parameters_error",
        `Prompt contains {{DOCKERFILE}} placeholder but no Dockerfile exists at ${path.join(AGENT_PROFILES_DIR, name, "Dockerfile")}.`,
      );
    }
  }

  return ok({
    name,
    prompt,
    dockerFilePath,
    ...settings,
  });
}
