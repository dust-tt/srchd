# AGENT.md - srchd Development Guide

## Project Information

**Project Name:** srchd (and srchd-mini)
**Language/Stack:** TypeScript/Node.js v20+
**Purpose:** AI agent orchestration system using publication/review collaboration model
**Database:** SQLite with Drizzle ORM

---

## Quick Start

### Requirements

- **Node.js v20+**
  - macOS with Homebrew: `export PATH="/opt/homebrew/opt/node@20/bin:$PATH"`

### Essential Commands

```bash
# Run CLI
npx tsx src/srchd.ts

# Type checking
npm run typecheck

# Linting
npm run lint

# Database migrations
npx drizzle-kit generate && npx drizzle-kit migrate

# Database backup (ALWAYS before migrations)
cp db.sqlite db.sqlite.backup-$(date +%Y%m%d-%H%M%S)
```

---

## TypeScript Standards

### Strict Rules

- **NEVER use `any` type** - always provide proper types
- **Enable strict mode** in tsconfig.json
- **Use CommonJS compilation target**
- **Configure `@app` alias** pointing to `src/` for absolute imports

### Code Style

- **Prefer `??` (nullish coalescing) over `||`**
- **Use trailing commas** in multiline objects/arrays
- **For ENUMs: No "default" case in switch statements** (exhaustive checking)

### Import Style

```typescript
// GOOD: Use absolute imports with @app alias
import { UserService } from '@app/services/user';

// AVOID: Relative imports
import { UserService } from '../../services/user';
```

---

## Development Philosophy

### Simplicity First

- **Not everything needs a class** - prefer functions when possible
- **Favor composition over inheritance**
- **Limit abstract classes** - prefer interfaces/trait-like patterns
- **Never over-engineer** - build only what's needed now
- **Strive for simplicity** - simple code is better than clever code

### Comments Philosophy

- **Use comments sparingly**
- **Make self-documenting code** - good variable names, clear types, obvious logic
- **Only comment when:**
  - Explaining particularly complex algorithms
  - Documenting invariants
  - Warning about non-obvious edge cases
  - Explaining "why" not "what"

**Good Example:**
```typescript
// Invariant: users array must be sorted by ID before binary search
function findUserById(users: User[], id: number): User | undefined {
  // ... binary search implementation
}
```

**Avoid:**
```typescript
// This function finds a user by ID
function findUserById(users: User[], id: number): User | undefined {
  // Loop through users
  for (const user of users) {
    // Check if ID matches
    if (user.id === id) {
      return user; // Return the user
    }
  }
}
```

---

## Test-Driven Development (TDD)

### Required Workflow

1. **Explore** - Understand the problem space and existing codebase
2. **Plan** - Think through the solution architecture
3. **Write Tests** - Create tests for expected behavior
4. **Verify Tests Fail** - Ensure no implementation code exists yet
5. **Implement** - Write minimal code to pass tests
6. **Refactor** - Clean up while keeping tests green
7. **Verify** - Run linters, type checkers, ensure 80%+ coverage

### Code Quality Goals

- **80%+ code coverage minimum**
- **Zero linting errors**
- **Zero type errors**
- **Self-documenting code**

---

## Architecture Overview

`srchd` orchestrates AI agents through a publication/review system. Agents collaborate to solve complex problems by publishing papers, reviewing each other's work, and citing relevant publications.

### Core Components

#### Database Layer (`src/db/`)

**ORM:** Drizzle ORM with SQLite backend (`./db.sqlite`)

**Schema Entities:**
- `experiments` - Experiment metadata with unique names and problem statements
- `agents` - AI agents with model, provider, thinking config, and tools
- `evolutions` - System prompt evolution history for self-improvement
- `messages` - Agent conversation history with position tracking
- `publications` - Research papers with status (SUBMITTED/PUBLISHED/REJECTED)
- `citations` - Citation relationships between publications
- `reviews` - Peer reviews with grades (STRONG_ACCEPT/ACCEPT/REJECT/STRONG_REJECT)
- `solutions` - Tracked solutions with reasoning and publication references
- `token_usages` - Token usage tracking for cost monitoring

**Key Data Relationships:**
- Experiments contain multiple agents
- Agents have memories and can author publications
- Publications can cite other publications within experiments
- Publications undergo peer review by agents
- All entities maintain created/updated timestamps

#### CLI Interface (`src/srchd.ts`)

Built with Commander.js, provides commands for:
- Experiment management (create, list, metrics)
- Agent management (create, list, evolve, run)
- Computer image building
- Web UI server

#### Agent Profile System (`src/agent_profile.ts`)

Profiles define pre-configured agent types in `agents/<profile-name>/`:
- **`prompt.md`** - System prompt defining behavior and objectives
- **`settings.json`** - Tools, environment variables, Docker image name
- **`Dockerfile`** (optional) - Custom Docker environment for computer-use agents

Available profiles: `research`, `security`, `arc-agi`, `code`, `formal-math`, `browse`, `security-browse`

#### Tools System (`src/tools/`)

Agents interact via MCP servers:

**Core Tools** (always available):
- `publications` - Search, submit, review publications
- `system_prompt_self_edit` - Get/update system prompt for self-improvement
- `goal_solution` - Get/advertise best solution

**Optional Tools** (per profile):
- `computer` - Execute commands, read/write files in Kubernetes pod
- `web` - Search and scrape web content

#### Models System (`src/models/`)

Supported providers: Anthropic, OpenAI, Google, Mistral, Moonshot AI, Deepseek

Thinking levels: `none`, `low`, `high`

#### Runner System (`src/runner/`)

Orchestrates tick-based agent execution:
1. Load evolution (system prompt) and message history
2. Create LLM with model + thinking config
3. Connect MCP tool servers
4. LLM generates response with tool calls
5. Execute tools and store results
6. Record token usage
7. Repeat until stopping condition

#### Computer System (`src/computer/`)

Manages Kubernetes pods for sandboxed agent execution:
- Isolated pods per agent with custom Docker images
- Persistent volumes for stateful work
- File system access and command execution

#### Resources Layer (`src/resources/`)

Abstraction over database entities: `ExperimentResource`, `AgentResource`, `PublicationResource`, `SolutionResource`, `TokenUsageResource`, `MessagesResource`

#### Server/UI (`src/server/`)

Web server (Hono) providing experiment monitoring, publication browsing, citation graphs, and usage analytics.

---

## Configuration

### Environment Variables

Required API keys:
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`
- `MISTRAL_API_KEY`, `MOONSHOT_API_KEY`, `DEEPSEEK_API_KEY`
- `FIRECRAWL_API_KEY` (optional, for web scraping)

### TypeScript Configuration

**tsconfig.json:**
- Strict mode enabled
- ESM modules with CommonJS compilation target
- Path aliases: `@app/*` → `src/*`

### Database Configuration

**drizzle.config.ts:**
- SQLite database with Drizzle migrations in `src/migrations/`
- **ALWAYS backup before migrations:** `cp db.sqlite db.sqlite.backup-$(date +%Y%m%d-%H%M%S)`

---

## Extension Points

### New Agent Profile
Create `agents/<name>/` with `prompt.md`, `settings.json`, and optional `Dockerfile`

### New Model Provider
Implement `LLM` interface in `src/models/<provider>.ts`, update `provider.ts`

### New Tool
Create MCP server in `src/tools/<tool>.ts`, add to `constants.ts`, configure in profile

---

## Performance & Security

- Concurrent agent execution with cost tracking
- Kubernetes pods isolate agent execution
- Custom Docker images restrict available tools
- API keys stored in environment only

---

## srchd-mini: Simplified Architecture

**Goal:** Maintain core multi-agent publication/review system while dramatically simplifying architecture.

### Key Simplifications

| Aspect | srchd | srchd-mini |
|--------|-------|------------|
| **Agents** | Named, per-agent config, separate table | Numbered indices, shared config, no table |
| **Tokens** | Per-agent tracking | Experiment total only |
| **Thinking** | Stored in DB | Runtime parameter (boolean) |
| **Provider** | Stored in agents table | Auto-detected from model |
| **Publications** | Stored in DB | Stored in filesystem |
| **Solutions** | Complex tracking | Simple voting system |
| **Grades** | 4 levels | 2 levels (ACCEPT/REJECT) |
| **Containers** | Kubernetes pods | Docker containers |
| **System Prompts** | Per-profile with evolutions | Single default prompt |
| **Tools** | 5 tools | 2 tools (computer, publications) |
| **CLI** | Multiple commands | Streamlined commands |
| **Running** | Can run specific agents | All agents or nothing |
| **UI** | Web + CLI | CLI only |

### Design Principles for srchd-mini

1. **No Agents Table** - All agents identical except index and message history
2. **Filesystem for Publications** - Easier to inspect, simpler for large content
3. **Binary Thinking** - Runtime optimization, not persistent config
4. **Simple Voting** - Direct votes instead of complex solution tracking
5. **Keep Context Pruning** - Existing loop detection is sophisticated and necessary
6. **Auto-detect Provider** - Model names are standardized (gpt-, claude-, etc.)

---

## Best Practices Summary

### Code Style
- Functions over classes
- Composition over inheritance
- Comments sparingly - prefer self-documenting code
- Never use `any` type
- Use absolute imports with `@app` alias

### Database
- Always backup before migrations
- Prefer local SQLite
- Use Drizzle ORM

### Testing
- TDD workflow always
- 80%+ code coverage minimum
- Tests before implementation

### Development
- Zero linting errors
- Zero type errors
- Strive for simplicity
- Build only what's needed now
