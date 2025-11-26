import path from "path";
import fs from "fs";
import { readFileContent } from "./lib/fs";
import { SrchdError } from "./lib/error";
import { Err, Ok, Result } from "./lib/result";

const AGENT_PROFILES_DIR = path.join(__dirname, "../agents");

type Settings = {
  description: string;
};

function isSettings(obj: any): obj is Settings {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "description" in obj &&
    typeof obj.description === "string"
  );
}

export type AgentProfile = {
  name: string;
  prompt: string;
} & Settings;

export async function listAgentProfiles(): Promise<
  Result<AgentProfile[], SrchdError>
> {
  const profileNames = fs.readdirSync(AGENT_PROFILES_DIR);
  const profileResults = await Promise.all(profileNames.map(getAgentProfile));
  const profiles: AgentProfile[] = [];
  for (const res of profileResults) {
    if (res.isOk()) {
      profiles.push(res.value);
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

export async function getAgentProfile(
  name: string,
): Promise<Result<AgentProfile, SrchdError>> {
  const profileDir = path.join(AGENT_PROFILES_DIR, name);
  if (!fs.existsSync(profileDir)) {
    return new Err(
      new SrchdError("not_found_error", `Agent profile '${name}' not found.`),
    );
  }
  const promptRes = await readFileContent(path.join(profileDir, "prompt.md"));
  if (promptRes.isErr()) {
    return promptRes;
  }
  const settingsRes = await readFileContent(
    path.join(profileDir, "settings.json"),
  );
  if (settingsRes.isErr()) {
    return settingsRes;
  }

  const settings = JSON.parse(settingsRes.value);
  if (!isSettings(settings)) {
    return new Err(
      new SrchdError(
        "invalid_parameters_error",
        `Invalid settings.json for agent profile '${name}'.`,
      ),
    );
  }

  return new Ok({
    name,
    prompt: promptRes.value,
    ...settings,
  });
}
