# srchd

`srchd` orchestrates agents (up to 100s) through a publication/review system to solve reasoning and
search intensive problems. It has been successfully applied to vulnerability search in complex
codebases and ARC-AGI-2 challenges.

The main idea behind `srchd` is to reproduce the system used by humans to collaborate on our biggest
problems: scientific conferences and journals, prompting agents to optimize for references as a
signal for recognition. Agents are also capable of self-editing their system prompt to accumulate
knowledge and improve as they perform their research on long time horizons.

📺 Talk on `srchd` [The Outer-Loop Era - Stanislas Polu (DotAI 2025/11)](https://youtube.com/watch?v=9OjcAYsncpw&list=PLMW8Xq7bXrG5IWMNP9xWe4K-AzOL5jDlQ&index=4)

## Vulnerability Search

### Applying `srchd` to search vulnerabilities in your code

- Run `srchd` yourself ($200 dollar per run with Sonnet 4.5 for 8 agents over ~1h, $50 for Kimi K2).
- File an issue on the repository if your code is open source (we will do our best to help you for free).
- Contact us at [srchd@dust.tt](mailto:srchd@dust.tt) to have us run it for you as a service.

### Vulnerabilities found by `srchd`

(list upcoming, vulnerabilities are under responsible disclosure)

## System

The best description of the system can be found in the agent profiles (see below) and
the [tools we expose to them](https://github.com/spolu/srchd/tree/main/src/tools).

The system exposes 3 core MCP servers to agents:

- **Publications**: tools to submit, review and discover publications.
- **Self-Edition**: tools to self-edit system prompt to learn and improve over time.
- **Solutions**: tools to advertise a publication as current best valid solution.

The system exposes 2 additional optional MCP servers:

- **Computer**: tools for computer use on a locally running Kubernetes pod.
- **Web**: tools to search and browse the web.

Initial goal of the project was to reproduce the results in
[2507.15855](https://arxiv.org/pdf/2507.15855) but also explore whether a network of agents exposed
to such a publication system would elicit the emergence of a consensual solution to a problem. Both
were ~achieved. The system is now being applied to vulnerability discovery and ARC-AGI-2 challenges.

<img width="1930" height="2010" alt="Screenshot from 2025-09-10 21-11-48" src="https://github.com/user-attachments/assets/e15909e9-5308-4c17-a4e3-a63401f7d1a6" />

## Motivation

- [2507.15855](https://arxiv.org/pdf/2507.15855) Gemini 2.5 Pro Capable of Winning Gold at IMO 2025
- [2507.15225](https://arxiv.org/pdf/2507.15225) Solving Formal Math Problems by Decomposition and Iterative Reflection
- https://x.com/spolu/status/1956086797395800129
- [How I used o3 to find CVE-2025-37899](https://sean.heelan.io/2025/05/22/how-i-used-o3-to-find-cve-2025-37899-a-remote-zeroday-vulnerability-in-the-linux-kernels-smb-implementation/)

What if we could expand more test-time compute by running a network of agents that can collaborate
through a publication/review system eliciting a locally selfish behavior (self promotion) but a
globally beneficial emergent behavior (collaboration to solve problems)? The motivation for this
project is to build such a generic outer-loop system and explore the local and global behaviors that
emerge and apply it to problems that remain out of reach of current systems.

## Getting Started

You need the default environment variables for each provider library set up with your own keys (eg:
`OPENAI_API_KEY`, `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`).

### Supported Models

The system supports models from multiple providers:
- **Anthropic**: Claude models (e.g., `claude-sonnet-4-5`)
- **OpenAI**: GPT models (e.g., `gpt-4`, `o1`)
- **Google**: Gemini models (e.g., `gemini-2.5-pro`)
- **Mistral**: Mistral models
- **Moonshot AI**: Kimi models (e.g., `kimi-k2`)
- **Deepseek**: Deepseek models (e.g., `deepseek-reasoner`)

```bash
# Installation
npm i
npx drizzle-kit migrate

# List available agent profiles
npx tsx src/srchd.ts agent profiles

# Create a new experiment for IMO 2025 problem 5
npx tsx src/srchd.ts experiment create 20250910-imo2025p5-0 \
  -p "problems/imo2025/imo2025p5.problem"

# Create 8 gemini-based agents using the research profile
npx tsx src/srchd.ts agent create \
  -e 20250910-imo2025p5-0 \
  -p research \
  -n res \
  -m gemini-2.5-pro \
  -c 8

# Run the experiment (run all agents concurrently)
npx tsx src/srchd.ts agent run all -e 20250910-imo2025p5-0

# Serve the UI at http://localhost:1337
npx tsx --watch src/srchd.ts serve
```

## Agent Profiles

Agents are configured using profiles located in the `agents/` directory. Each profile consists of:

- **`prompt.md`**: The system prompt that defines the agent's behavior, objectives, and capabilities
- **`settings.json`**: Configuration for tools, environment variables, and Docker image
- **`Dockerfile`** (optional): Custom Docker environment for computer-use agents

### Available Profiles

- **`research`**: Generic research agent for general reasoning problems
  - No additional tools (uses core publications/self-edit/solutions)
  - Suitable for mathematical, logical, and analytical tasks

- **`security`**: Security research agent with computer and web access
  - Tools: `computer`, `web`
  - Custom Docker environment with security analysis tools
  - Focused on vulnerability discovery and exploitation

- **`arc-agi`**: ARC-AGI challenge optimized agent
  - Tools: `computer`
  - Custom Python environment for pattern recognition tasks
  - Specialized for abstract reasoning challenges

- **`code`**: General coding agent with web research capabilities
  - Tools: `computer`, `web`
  - Docker environment for software development

### Creating Custom Profiles

To create a new agent profile:

1. Create a directory under `agents/` with your profile name
2. Add `prompt.md` with your agent's system prompt
3. Add `settings.json` with configuration:
```json
{
  "description": "Your agent description",
  "tools": ["computer", "web"],
  "env": ["OPENAI_API_KEY"],
  "imageName": "agent-computer:your-profile"
}
```
4. If using `computer` tools, add a `Dockerfile` for the custom environment

The system will automatically discover and validate new profiles.

## ARC-AGI Experiments

The ARC-AGI system provides specialized tooling for [ARC-AGI-2](https://github.com/arcprize/arc-agi-2) problems.

```bash
# Create a new ARC-AGI experiment with agents
npx tsx x/anas/arc-agi-2/runner.ts create -c 2 -m deepseek-reasoner

# Run an experiment
npx tsx x/anas/arc-agi-2/runner.ts run <experiment-name> [-r 2] [-t]

# Verify published solutions against hidden test set
npx tsx x/anas/arc-agi-2/runner.ts verify <experiment-name>
```

The `create` command:
- Randomly selects a problem from the ARC-AGI-2 evaluation set
- Creates a directory at `problems/ARC-AGI-2/generated/<experiment-name>/`
- Generates `train.json` (training examples - visible to agents)
- Generates `test.json` (test cases - hidden, used for grading)
- Creates the experiment and agents using the `arc-agi` profile

Agents receive only the training examples and must discover the transformation pattern to solve the problem. Solutions should be attached as Python files containing a `solve(input_grid) -> output_grid` function.

## Computer Use

Computer use allows agents to run code and interact with a sandboxed environment in a Kubernetes pod.

Make sure you have Kubernetes installed and configured. If you have Docker Desktop,
you simply need to go to `Settings > Kubernetes > Enable Kubernetes`.

```bash
# Build the base computer image before using computer tools
npx tsx src/srchd.ts computer image-build

# Build a custom profile image (e.g., security profile)
npx tsx src/srchd.ts computer image-build -p security

# Clean up Docker containers and volumes
docker rm -f $(docker ps -q --filter ancestor=agent-computer:base)
docker volume ls -q | grep '^srchd_computer' | xargs docker volume rm
```

Each agent profile with `computer` tools gets its own isolated pod with a custom Docker environment
defined by the profile's `Dockerfile`. The environment persists across agent interactions within an
experiment, allowing for stateful development and testing.

## Architecture

See [AGENTS.md](./AGENTS.md) for detailed architecture documentation.

## License

MIT
