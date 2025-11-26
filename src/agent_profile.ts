import path from "path";
import fs from "fs";
import { readFileContent } from "./lib/fs";
import { SrchdError } from "./lib/error";
import { Err, Ok, Result } from "./lib/result";
import {
  isNonDefaultToolNameList,
  NonDefaultToolName,
} from "./tools/constants";

const AGENT_PROFILES_DIR = path.join(__dirname, "../agents");

type Settings = {
  description: string;
  tools: NonDefaultToolName[];
};

function isSettings(obj: any): obj is Settings {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "description" in obj &&
    typeof obj.description === "string" &&
    "tools" in obj &&
    isNonDefaultToolNameList(obj.tools)
  );
}

export type AgentProfile = {
  name: string;
  prompt: string;
} & Settings;

export async function listAgentProfiles(): Promise<
  Result<{ name: string; description: string }[], SrchdError>
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
      return new Err(
        new SrchdError(
          "invalid_parameters_error",
          "Invalid agent profile(s) found.",
        ),
      );
    }
  }
  return new Ok(profiles);
}

async function readSettings(
  path: string,
): Promise<Result<Settings, SrchdError>> {
  if (!fs.existsSync(path)) {
    return new Err(
      new SrchdError("not_found_error", `Settings file '${path}' not found.`),
    );
  }
  const settingsRes = await readFileContent(path);
  if (settingsRes.isErr()) {
    return settingsRes;
  }

  const settings = JSON.parse(settingsRes.value);
  if (!isSettings(settings)) {
    return new Err(
      new SrchdError(
        "invalid_parameters_error",
        `Invalid settings.json at '${path}'.`,
      ),
    );
  }
  return new Ok(settings);
}

export async function getAgentProfile(
  name: string,
): Promise<Result<AgentProfile, SrchdError>> {
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
  return new Ok({
    name,
    prompt: promptRes.value,
    ...settings,
  });
}
