import { PassThrough } from "stream";
import { Terminal } from "@xterm/xterm";

export type ProcessStatus =
  | 'running'
  | 'terminated';

export type Process = {
  pid: number;
  status: ProcessStatus;
  stdinStream: PassThrough;
  stdoutStream: PassThrough;
  stderrStream: PassThrough;
  output: { stdout: string; stderr: string };
  get stdout(): string;
  get stderr(): string;
  exitCode?: number;
  createdAt: Date;
  command: string;
  cwd: string;
  env: Record<string, string>;
  promise?: Promise<void>;
  tty: boolean;
  terminal?: Terminal;
  getTerminalBuffer(): string;
}

export function newProcess(
  command: string,
  cwd: string,
  env: Record<string, string>,
  tty: boolean = false,
): Process {

  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  // Since JS strings are passed by value, we need to use getters to capture the output
  const output = { stdout: "", stderr: "" };

  // Create terminal instance for TTY mode
  let terminal: Terminal | undefined;
  if (tty) {
    terminal = new Terminal({
      cols: 120,
      rows: 30,
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
      allowProposedApi: true,
    });
  }

  const originalStdoutWrite = stdoutStream.write.bind(stdoutStream);
  stdoutStream.write = (chunk: any, ...args: any[]) => {
    if (chunk && chunk !== null) {
      const text = chunk.toString();
      output.stdout += text;

      // Write to terminal if in TTY mode
      if (terminal) {
        terminal.write(text);
      }
    }
    return originalStdoutWrite(chunk, ...args);
  };

  const originalStderrWrite = stderrStream.write.bind(stderrStream);
  stderrStream.write = (chunk: any, ...args: any[]) => {
    if (chunk && chunk !== null) {
      const text = chunk.toString();
      output.stderr += text;

      // In TTY mode, stderr also goes to terminal (like real TTY behavior)
      if (terminal) {
        terminal.write(text);
      }
    }
    return originalStderrWrite(chunk, ...args);
  };

  const stdinStream = new PassThrough();

  return {
    pid: -1, // Nonexistent when starting process
    status: 'running',
    stdinStream,
    stdoutStream,
    stderrStream,
    output,
    get stdout() { return output.stdout; },
    get stderr() { return output.stderr; },
    exitCode: undefined,
    createdAt: new Date(),
    command,
    cwd,
    env,
    tty,
    terminal,
    getTerminalBuffer(): string {
      if (!terminal) {
        return output.stdout;
      }

      // Serialize the terminal buffer
      const buffer = terminal.buffer.active;
      const lines: string[] = [];

      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i);
        if (line) {
          lines.push(line.translateToString(true));
        }
      }

      return lines.join('\n');
    },
  };
}
