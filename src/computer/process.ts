import { PassThrough, Writable } from "stream";
import { Terminal } from "@xterm/xterm";

const MAX_OUTPUT_CHARS = 1024 * 1024; // Keep only the last 1MB per stream.

export type ProcessStatus =
  | 'running'
  | 'terminated';

export type Process = {
  pid: number;
  status: ProcessStatus;
  stdinStream: PassThrough;
  stdoutStream: Writable;
  stderrStream: Writable;
  output: { stdout: string; stderr: string };
  get stdout(): string;
  get stderr(): string;
  detectedPid?: number;
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

function appendToBoundedBuffer(
  current: string,
  incoming: string,
  maxChars: number,
): { value: string; truncatedChars: number } {
  if (incoming.length >= maxChars) {
    return {
      value: incoming.slice(-maxChars),
      truncatedChars: current.length + incoming.length - maxChars,
    };
  }

  const overflow = current.length + incoming.length - maxChars;
  if (overflow <= 0) {
    return {
      value: current + incoming,
      truncatedChars: 0,
    };
  }

  return {
    value: current.slice(overflow) + incoming,
    truncatedChars: overflow,
  };
}

function formatBufferedOutput(value: string, truncatedChars: number): string {
  if (truncatedChars <= 0) {
    return value;
  }

  return `[srchd truncated ${truncatedChars} chars of earlier output; showing the most recent ${value.length} chars]\n${value}`;
}

export function newProcess(
  command: string,
  cwd: string,
  env: Record<string, string>,
  tty: boolean = false,
): Process {

  const output = {
    stdout: "",
    stderr: "",
    stdoutTruncatedChars: 0,
    stderrTruncatedChars: 0,
  };

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

  const processRef: { current?: Process } = {};

  const detectPid = (text: string) => {
    const pidMatch = text.match(/SRCHD_PID:(\d+)/);
    if (!pidMatch?.[1] || !processRef.current) {
      return;
    }

    const pid = parseInt(pidMatch[1], 10);
    processRef.current.detectedPid = pid;
    processRef.current.pid = pid;
  };

  const stdoutStream = new Writable({
    write(chunk: any, _encoding, callback) {
      try {
        if (chunk !== undefined && chunk !== null) {
          const text = chunk.toString();
          const next = appendToBoundedBuffer(output.stdout, text, MAX_OUTPUT_CHARS);
          output.stdout = next.value;
          output.stdoutTruncatedChars += next.truncatedChars;
          detectPid(text);

          // Write to terminal if in TTY mode
          if (terminal) {
            terminal.write(text);
          }
        }
        callback();
      } catch (e) {
        callback(e as Error);
      }
    },
  });

  const stderrStream = new Writable({
    write(chunk: any, _encoding, callback) {
      try {
        if (chunk !== undefined && chunk !== null) {
          const text = chunk.toString();
          const next = appendToBoundedBuffer(output.stderr, text, MAX_OUTPUT_CHARS);
          output.stderr = next.value;
          output.stderrTruncatedChars += next.truncatedChars;
          detectPid(text);

          // In TTY mode, stderr also goes to terminal (like real TTY behavior)
          if (terminal) {
            terminal.write(text);
          }
        }
        callback();
      } catch (e) {
        callback(e as Error);
      }
    },
  });

  const stdinStream = new PassThrough();

  const process: Process = {
    pid: -1, // Nonexistent when starting process
    status: 'running',
    stdinStream,
    stdoutStream,
    stderrStream,
    output,
    get stdout() {
      return formatBufferedOutput(output.stdout, output.stdoutTruncatedChars);
    },
    get stderr() {
      return formatBufferedOutput(output.stderr, output.stderrTruncatedChars);
    },
    detectedPid: undefined,
    exitCode: undefined,
    createdAt: new Date(),
    command,
    cwd,
    env,
    tty,
    terminal,
    getTerminalBuffer(): string {
      if (!terminal) {
        return formatBufferedOutput(output.stdout, output.stdoutTruncatedChars);
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
  processRef.current = process;

  return process;
}
