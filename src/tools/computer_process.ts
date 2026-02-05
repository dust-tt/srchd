import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AgentResource } from "@app/resources/agent";
import { errorToCallToolResult } from "@app/lib/mcp";
import { COMPUTER_REGISTRY } from "@app/computer";
import { COMPUTER_PROCESS_SERVER_NAME as SERVER_NAME } from "@app/tools/constants";
import { err } from "@app/lib/error";
import { DEFAULT_WORKDIR } from "@app/computer/definitions";

const SERVER_VERSION = "0.1.0";
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_TIMEOUT_MS = 60000;
const MAX_PROCESSES = 32;
const MAX_STDOUT_SIZE = 8192;


export async function createComputerProcessServer(
  agent: AgentResource,
): Promise<McpServer> {
  const server = new McpServer({
    name: SERVER_NAME,
    title: `Process Management: Tools to spawn and manage long-running processes in a computer environment.`,
    version: SERVER_VERSION,
  });

  // Register computer instance

  // Helper to get computer instance
  const getComputer = () => {
    return COMPUTER_REGISTRY[agent.toJSON().name];
  };

  // spawn - Execute a command and return its output or background it
  server.tool(
    "spawn",
    `\
Executes a command and returns its output. Processes exceeding the timeout (default 10s) are automatically moved to background execution. You can also specify to immediately background it.

**Use cases:**
- Run quick commands with immediate output
- Start long-running processes (servers, builds) in background
- Execute commands that need stdin interaction

**TTY Mode:**
Enable tty: true for interactive terminal applications (vim, htop, python REPL, etc.).
- Required for control sequences sent via stdin (ESC, arrows, Ctrl-C, etc.) to work
- Output is rendered cleanly without ANSI escape codes
- MUST use with background: false if you need stdin interaction

**IMPORTANT - Stdin Limitation:**
The stdin tool only works for tty: true processes.
If you send stdin to a background process that is not interactive, it will be closed automatically.

**Returns:** Process status (running, terminated), exit code, stdout, stderr, and process ID

**Examples:**
- Quick command: spawn({ command: "ls -la" })
- Interactive: spawn({ command: "python", tty: true, background: true })
- Background server: spawn({ command: "python -m http.server 8000", background: true })
- Long build: spawn({ command: "npm install", timeout: 60, background: true })`,
    {
      command: z.string().describe("Command to execute"),
      cwd: z
        .string()
        .optional()
        .default(DEFAULT_WORKDIR)
        .describe(`Working directory for the process (default: ${DEFAULT_WORKDIR})`),
      env: z
        .record(z.string())
        .optional()
        .describe("Environment variables"),
      timeoutMs: z
        .number()
        .int()
        .max(MAX_TIMEOUT_MS)
        .optional()
        .describe(
          `Timeout in milliseconds (max ${MAX_TIMEOUT_MS}, default ${DEFAULT_TIMEOUT_MS}).
          Processes exceeding timeout move to background.`,
        ),
      background: z
        .boolean()
        .default(false)
        .describe("Whether to immediately run command in background"),
      tty: z
        .boolean()
        .default(false)
        .describe("Whether to run command in (TTY) interactive mode"),
    },
    async ({ command, cwd, env, timeoutMs, background, tty }) => {
      const computer = getComputer();
      if (!computer) {
        return errorToCallToolResult(
          err("computer_run_error", "Failed to access running computer"),
        );
      }

      console.log(`\x1b[90m[spawn] ${command}\x1b[0m`);

      timeoutMs = background
        ? undefined
        : timeoutMs ?? DEFAULT_TIMEOUT_MS;

      const r = await computer.spawn(command, {
        cwd: cwd ?? DEFAULT_WORKDIR,
        env,
        timeoutMs,
        tty,
      });

      if (r.isErr()) {
        return errorToCallToolResult(r);
      }

      const result = r.value;
      const backgrounded = result.status === "running" || background;

      // Truncate output for display
      const stdout = tty && result.terminal
        ? result.getTerminalBuffer().slice(0, MAX_STDOUT_SIZE) +
        (result.getTerminalBuffer().length > MAX_STDOUT_SIZE ? "\n...[truncated]" : "")
        : result.stdout.slice(0, MAX_STDOUT_SIZE) +
        (result.stdout.length > MAX_STDOUT_SIZE ? "\n...[truncated]" : "");
      const stderr =
        result.stderr.slice(0, MAX_STDOUT_SIZE) +
        (result.stderr.length > MAX_STDOUT_SIZE ? "\n...[truncated]" : "");

      // Return status and output separately for clarity
      const statusText = `id: ${result.pid}\nstatus: ${result.status}\nbackgrounded: ${backgrounded}\ntty: ${tty}${result.exitCode !== undefined ? `\nexit_code: ${result.exitCode}` : ""}`;

      const stdoutText = `stdout:\n\`\`\`\n${stdout}\n\`\`\``;

      const content = [
        { type: "text" as const, text: statusText },
        { type: "text" as const, text: stdoutText },
      ];

      if (!tty && stderr) {
        content.push({
          type: "text" as const,
          text: `stderr:\n\`\`\`\n${stderr}\n\`\`\``,
        });
      }

      return {
        isError: false,
        content,
      };
    },
  );

  // ps - List all processes
  server.tool(
    "ps",
    `\
Lists all processes in order of creation, showing their current status (running / terminated). Recently ended processes are temporarily displayed (up to ${MAX_PROCESSES} total processes).

**Returns:** List of processes with ID, status, command, creation time, and exit code (if terminated)

**Example output:**
- [123] running: "npm run dev" (created: 2024-01-01T10:00:00Z)
- [124] terminated (exit: 0): "ls -la" (created: 2024-01-01T10:00:05Z)`,
    {},
    async () => {
      const computer = getComputer();
      if (!computer) {
        return errorToCallToolResult(
          err("computer_run_error", "Failed to access running computer"),
        );
      }

      const r = computer.ps();
      if (r.isErr()) {
        return errorToCallToolResult(r);
      }

      const processes = r.value;

      if (processes.length === 0) {
        return {
          isError: false,
          content: [
            {
              type: "text",
              text: "No processes found.",
            },
          ],
        };
      }

      const processLines = processes.map((p) => {
        let line = `[${p.pid}] ${p.status}`;
        if (p.exitCode !== undefined) {
          line += ` (exit: ${p.exitCode})`;
        }
        line += `: "${p.command}"`;
        line += ` (created: ${p.createdAt.toISOString()})`;
        line += ` (cwd: ${p.cwd})`;
        line += ` (env: ${Object.keys(p.env).join(", ")})`;
        line += ` (tty: ${p.tty})`;
        return line;
      });

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: `Processes:\n${processLines.join("\n")}`,
          },
        ],
      };
    },
  );



  // stdin - Send input to a process
  server.tool(
    "stdin",
    `\
Sends input to a running process's stdin stream, enabling interaction with interactive applications.

**IMPORTANT - Stdin Availability:**
- stdin only works for INTERACTIVE processes (tty: true)
- Background processes will not parse stdin escape sequences correctly
- If you need stdin interaction, set tty: true

**Control Characters:**
For TTY processes, you can send control characters using hex escape sequences:
- \\x03 for Ctrl-C (interrupt)
- \\x04 for Ctrl-D (EOF)
- \\x1A for Ctrl-Z (suspend)
- \\x1B for ESC key
- \\x1B[A for Up arrow
- \\x1B[B for Down arrow
- \\x1B[C for Right arrow
- \\x1B[D for Left arrow
- \\x7F for Backspace
- \\r for Enter/Return
- \\n for newline

**Use cases:**
- Interact with prompts (e.g., python input(), confirmation dialogs)
- Send commands to REPLs or shells
- Control interactive terminal applications (vim, nano, etc.)
- Send control signals to processes

**Returns:** Success status, last 100 lines of stdout after sending input, stderr, and exit code if available

**Examples:**
- stdin({ id: "123", input: "yes\\n" }) - Confirm a prompt
- stdin({ id: "124", input: "\\x03" }) - Send Ctrl-C to interrupt
- stdin({ id: "125", input: "print('hello')\\n" }) - Send to Python REPL
- stdin({ id: "126", input: "\\x1B[A\\r" }) - Up arrow then enter
- stdin({ id: "127", input: "iHello World!\\x1B:wq\\r" }) - VIM: insert text, escape, save and quit`,
    {
      id: z.string().describe("Process ID"),
      input: z.string().describe("Input to send to the process stdin"),
    },
    async ({ id, input }) => {
      const computer = getComputer();
      if (!computer) {
        return errorToCallToolResult(
          err("computer_run_error", "Failed to access running computer"),
        );
      }
      console.log(`\x1b[90m[stdin ${id}] ${input.replace(/\n/g, "\\n").replace(/\x1B/g, "\\x1B")}\x1b[0m`);

      const pid = parseInt(id, 10);
      if (isNaN(pid)) {
        return errorToCallToolResult(
          err("invalid_parameters_error", `Invalid process ID: ${id}`),
        );
      }

      // Check if process exists and has tty enabled
      const processCheck = computer.stdout(pid);
      if (processCheck.isErr()) {
        return errorToCallToolResult(processCheck);
      }

      if (!processCheck.value.tty) {
        return errorToCallToolResult(
          err(
            "invalid_parameters_error",
            `stdin can only be used with processes spawned with tty: true. Process ${id} was spawned without tty.`,
          ),
        );
      }

      const r = computer.stdin(pid, input);
      if (r.isErr()) {
        return errorToCallToolResult(r);
      }

      const process = r.value;

      // Get last 100 lines of stdout, using terminal buffer for TTY
      const stdout = process.tty && process.terminal
        ? process.getTerminalBuffer()
        : process.stdout;
      const stdoutLines = stdout
        .split("\n")
        .slice(-100)
        .join("\n")
        .slice(0, MAX_STDOUT_SIZE) +
        (stdout.split("\n").slice(-100).join("\n").length > MAX_STDOUT_SIZE ? "\n...[truncated]" : "");
      const stderr = process.stderr;

      let text = `success: true\n`;
      text += `status: ${process.status}\n`;
      text += `tty: ${process.tty}\n`;
      if (process.exitCode !== undefined) {
        text += `exit_code: ${process.exitCode}\n`;
      }
      text += `stdout (last 100 lines):\n\`\`\`\n${stdoutLines}\n\`\`\`\n`;
      if (!process.tty && stderr) {
        text += `stderr:\n\`\`\`\n${stderr.slice(0, MAX_STDOUT_SIZE)}${stderr.length > MAX_STDOUT_SIZE ? "\n...[truncated]" : ""}\n\`\`\``;
      }

      return {
        isError: false,
        content: [{ type: "text", text }],
      };
    },
  );

  // stdout - View process output
  server.tool(
    "stdout",
    `\
Displays the tail of a process's stdout (for long outputs), stderr, current status, and exit code if available.

**Background Process Behavior:**
When a process is moved to background (either explicitly or via timeout), this command shows any output received up until that point. The output buffer continues to accumulate while the process runs in the background.

**Use cases:**
- Check progress of long-running processes
- View recent output without re-running
- Monitor background processes
- Debug failed processes

**Returns:** Process status, stdout tail, stderr, exit code, and whether it's interactive

**Example:**
stdout({ id: "123", lines: 50 }) - View last 50 lines of output`,
    {
      id: z.string().describe("Process ID"),
      lines: z
        .number()
        .int()
        .positive()
        .optional()
        .default(100)
        .describe("Number of lines to show from stdout tail (default: 100)"),
    },
    async ({ id, lines }) => {
      const computer = getComputer();
      if (!computer) {
        return errorToCallToolResult(
          err("computer_run_error", "Failed to access running computer"),
        );
      }

      const pid = parseInt(id, 10);
      if (isNaN(pid)) {
        return errorToCallToolResult(
          err("invalid_parameters_error", `Invalid process ID: ${id}`),
        );
      }

      const r = computer.stdout(pid);
      if (r.isErr()) {
        return errorToCallToolResult(r);
      }

      const process = r.value;

      // Get last N lines of stdout, using terminal buffer for TTY
      const stdout = process.tty && process.terminal
        ? process.getTerminalBuffer()
        : process.stdout;
      const stdoutLines = stdout
        .split("\n")
        .slice(-(lines ?? 100))
        .join("\n")
        .slice(0, MAX_STDOUT_SIZE) +
        (stdout.split("\n").slice(-(lines ?? 100)).join("\n").length > MAX_STDOUT_SIZE ? "\n...[truncated]" : "");
      const stderr = process.stderr.slice(0, MAX_STDOUT_SIZE) +
        (process.stderr.length > MAX_STDOUT_SIZE ? "\n...[truncated]" : "");

      const statusText = `id: ${id}\nstatus: ${process.status}\ninteractive: ${process.tty}\ntty: ${process.tty}${process.exitCode !== undefined ? `\nexit_code: ${process.exitCode}` : ""}`;

      const stdoutText = `stdout (last ${lines ?? 100} lines):\n\`\`\`\n${stdoutLines}\n\`\`\``;

      const content = [
        { type: "text" as const, text: statusText },
        { type: "text" as const, text: stdoutText },
      ];

      if (!process.tty && stderr) {
        content.push({
          type: "text" as const,
          text: `stderr:\n\`\`\`\n${stderr}\n\`\`\``,
        });
      }

      return {
        isError: false,
        content,
      };
    },
  );

  // signal - Terminate a process
  server.tool(
    "kill",
    `\
Sends a signal to a running process, causing it to terminate.

**Use cases:**
- Stop long-running background processes
- Cancel stuck processes
- Clean up completed servers

**Signals:**
- SIGTERM (default): Graceful termination
- SIGKILL: Forceful termination
- SIGINT: Interrupt (Ctrl+C equivalent)

**Returns:** Success status and optional error message

**Example:**
kill({ id: "123" }) - Gracefully terminate process 123
kill({ id: "124", signal: "SIGKILL" }) - Force kill process 124`,
    {
      id: z.string().describe("Process ID to kill"),
      signal: z
        .string()
        .optional()
        .default("SIGTERM")
        .describe("Signal to send (default: SIGTERM)"),
    },
    async ({ id, signal }) => {
      const computer = getComputer();
      if (!computer) {
        return errorToCallToolResult(
          err("computer_run_error", "Failed to access running computer"),
        );
      }

      console.log(`\x1b[90m[signal ${signal ?? "SIGTERM"}] ${id}\x1b[0m`);

      const pid = parseInt(id, 10);
      if (isNaN(pid)) {
        return errorToCallToolResult(
          err("invalid_parameters_error", `Invalid process ID: ${id}`),
        );
      }

      const r = await computer.kill(pid, signal ?? "SIGTERM");
      if (r.isErr()) {
        return errorToCallToolResult(r);
      }

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: `success: true\nProcess ${id} sent ${signal ?? "SIGTERM"} signal.`,
          },
        ],
      };
    },
  );

  return server;
}
