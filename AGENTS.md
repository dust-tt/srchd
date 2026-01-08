# AGENTS.md - Architecture Documentation

## Requirements

- **Node.js**: v24+ required
  - On macOS with Homebrew: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`

## Commands

- **Run CLI**: `npx tsx src/srchd.ts`
- **Type checking**: `npm run typecheck`
- **Linting**: `npm run lint`
- **Database migrations**: `npx drizzle-kit generate && npx drizzle-kit migrate`

## Architecture Overview

`srchd` orchestrates AI agents through a publication/review system. Agents collaborate to solve complex problems by publishing papers, reviewing each other's work, and citing relevant publications.

## Core Components

### Database Layer (`src/db/`)

**ORM**: Drizzle ORM with SQLite backend (`./db.sqlite`)

**Schema Entities**:
- `experiments` - Experiment metadata with unique names and problem statements
- `agents` - AI agents with model, provider, thinking config, and tools
- `evolutions` - System prompt evolution history for self-improvement
- `messages` - Agent conversation history with position tracking
- `publications` - Research papers with status (SUBMITTED/PUBLISHED/REJECTED)
- `citations` - Citation relationships between publications
- `reviews` - Peer reviews with grades (STRONG_ACCEPT/ACCEPT/REJECT/STRONG_REJECT)
- `solutions` - Tracked solutions with reasoning and publication references
- `token_usages` - Token usage tracking for cost monitoring

**Key Data Relationships**:
- Experiments contain multiple agents
- Agents have memories and can author publications
- Publications can cite other publications within experiments
- Publications undergo peer review by agents
- All entities maintain created/updated timestamps

### CLI Interface (`src/srchd.ts`)

Built with Commander.js, provides commands for:
- Experiment management (create, list, metrics)
- Agent management (create, list, evolve, run)
- Computer image building
- Web UI server

### Agent Profile System (`src/agent_profile.ts`)

Profiles define pre-configured agent types in `agents/<profile-name>/`:
- **`prompt.md`** - System prompt defining behavior and objectives
- **`settings.json`** - Tools, environment variables, Docker image name
- **`Dockerfile`** (optional) - Custom Docker environment for computer-use agents

Available profiles: `research`, `security`, `arc-agi`, `code`, `formal-math`, `browse`, `security-browse`

### Tools System (`src/tools/`)

Agents interact via MCP servers:

**Core Tools** (always available):
- `publications` - Search, submit, review publications
- `system_prompt_self_edit` - Get/update system prompt for self-improvement
- `goal_solution` - Get/advertise best solution

**Optional Tools** (per profile):
- `computer` - Execute commands, read/write files in Kubernetes pod
- `web` - Search and scrape web content

### Models System (`src/models/`)

Supported providers: Anthropic, OpenAI, Google, Mistral, Moonshot AI, Deepseek

Thinking levels: `none`, `low`, `high`

### Runner System (`src/runner/`)

Orchestrates tick-based agent execution:
1. Load evolution (system prompt) and message history
2. Create LLM with model + thinking config
3. Connect MCP tool servers
4. LLM generates response with tool calls
5. Execute tools and store results
6. Record token usage
7. Repeat until stopping condition

### Computer System (`src/computer/`)

Manages Kubernetes pods for sandboxed agent execution:
- Isolated pods per agent with custom Docker images
- Persistent volumes for stateful work
- File system access and command execution

### Resources Layer (`src/resources/`)

Abstraction over database entities: `ExperimentResource`, `AgentResource`, `PublicationResource`, `SolutionResource`, `TokenUsageResource`, `MessagesResource`

### Server/UI (`src/server/`)

Web server (Hono) providing experiment monitoring, publication browsing, citation graphs, and usage analytics.

## Configuration

**Environment Variables**:
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`
- `MISTRAL_API_KEY`, `MOONSHOT_API_KEY`, `DEEPSEEK_API_KEY`
- `FIRECRAWL_API_KEY` (optional, for web scraping)

**TypeScript** (`tsconfig.json`):
- Strict mode enabled
- ESM modules with CommonJS compilation target
- Path aliases: `@app/*` → `src/*`

**Database** (`drizzle.config.ts`):
- SQLite database with Drizzle migrations in `src/migrations/`

## Extension Points

**New Agent Profile**: Create `agents/<name>/` with `prompt.md`, `settings.json`, and optional `Dockerfile`

**New Model Provider**: Implement `LLM` interface in `src/models/<provider>.ts`, update `provider.ts`

**New Tool**: Create MCP server in `src/tools/<tool>.ts`, add to `constants.ts`, configure in profile

## Performance & Security

- Concurrent agent execution with cost tracking
- Kubernetes pods isolate agent execution
- Custom Docker images restrict available tools
- API keys stored in environment only
