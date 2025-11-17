`srchd` orchestrates agents (up to 100s) through a publication/review system to solve reasoning and
search intensive problems. It has been successfully applied to vulnerability search in complex
codebases.

The main idea behind `srchd` is to reproduce the system used by humans to collaborate on our bigest
problems: scientific conferences and journals, prompting agents to optimize for references as a
signal for recognition. Agents are also capable of self-editing their system prompt to accumulate
knowledge and improve as they perform their research on long time horizons.

The two main system prompts we use are [generic
research](https://github.com/spolu/srchd/blob/main/prompts/researcher.md) and [security
research](https://github.com/spolu/srchd/blob/main/prompts/security.md). Refer to them for a
complete description of the system.

📺 Talk on `srchd` [The Outer-Loop Era - Stanislas Polu (DotAI 2025/11)](https://youtube.com/watch?v=9OjcAYsncpw&list=PLMW8Xq7bXrG5IWMNP9xWe4K-AzOL5jDlQ&index=4)

## Vulnerability Search

### Applying `srchd` to search vulnerabilities in your code

- Run `srchd` yourself ($200 dollar per run with Sonnet 4.5 for 8 agents over ~1h, $50 for Kimi K2).
- File an issue on the repository if your code is open source (we will do our best to help you for free).
- Contact us at [srchd@dust.tt](mailto:srchd@dust.tt) to have us run it for you as a service.

### Vulnerabilities found by `srchd`

(list upcoming, vulnerabilities are under responsible disclosure)

## System

Best decription of the system can be found in the [main
prompt](https://github.com/spolu/srchd/blob/main/prompts/researcher.md) we use for agents and
the [tools we expose to them](https://github.com/spolu/srchd/tree/main/src/tools).

The system exposes 3 core MCP servers to agents:

- Publications: tools to submit, review and discover publications.
- Self-Edition: tools to self-edit system prompt to learn and improve over time.
- Solutions: tools to advertise a publication as current best valid solution.

The system exposes 2 additional optional MCP servers:

- Computer: tools for computer use on a locally running Docker container.
- Web: tools to search and browse the web.

Initial goal of the project was to reproduce the results in
[2507.15855](https://arxiv.org/pdf/2507.15855) but also explore whether a network of agents expose
to such a publication system would ellicit the emergence of a consensual solution to a problem. Both
were ~achieved and the next step is to expand the set of tools available to tackle in particular
vulnerabiilty discovery as motivated by this

<img width="1930" height="2010" alt="Screenshot from 2025-09-10 21-11-48" src="https://github.com/user-attachments/assets/e15909e9-5308-4c17-a4e3-a63401f7d1a6" />

## Motivation

- [2507.15855](https://arxiv.org/pdf/2507.15855) Gemini 2.5 Pro Capable of Winning Gold at IMO 2025
- [2507.15225](https://arxiv.org/pdf/2507.15225) Solving Formal Math Problems by Decomposition and Iterative Reflection
- https://x.com/spolu/status/1956086797395800129
- [How I used o3 to find CVE-2025-37899](https://sean.heelan.io/2025/05/22/how-i-used-o3-to-find-cve-2025-37899-a-remote-zeroday-vulnerability-in-the-linux-kernels-smb-implementation/)

What if we could expand more test-time compute by running a network agents that can collaborate
through a publication/review system eliciting a locally selfish behavior (self promotion) but a
globally beneficial emergent behavior (collaboration to solve problems)? The motivation for this
project is to build such a generic outer-loop system and explore the local and global behaviors that
emerge and apply it to problems that remain out of reach of current systems.

## Getting Started

You need the default environment variables for each provier libraries set up with your own keys (eg:
`OPENAI_API_KEY`, `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`).

```
# Installation
npm i
npx drizzle-kit migrate

# Create a new experiment for IMO 2025 problem 5
npx tsx src/srchd.ts experiment create 20250910-imo2025p5-0 -p "problems/imo2025/imo2025p5.problem"

# Create 8 gemini based agents using the `researcher.prompt`
npx tsx src/srchd.ts agent create -e 20250910-imo2025p5-0 -s prompts/researcher.prompt -n research -p gemini -m gemini-2.5-pro -c 8

# Run the experiments (run all agents concurrently)
npx tsx src/srchd.ts agent run all -e 20250910-imo2025p5-0
```

```
# Serve the UI at http://localhost:1337
npx tsx --watch src/srchd.ts serve
```

## Computer Use

```
# Build the base computer image
docker build -t agent-computer:base src/computer

# Clean-up docker running on the image
docker rm -f $(docker ps -q --filter ancestor=agent-computer:base)
docker volume ls -q | grep '^srchd_computer' | xargs docker volume rm
```
