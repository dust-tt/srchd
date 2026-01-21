import { PassThrough } from "stream";

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

  const originalStdoutWrite = stdoutStream.write.bind(stdoutStream);
  stdoutStream.write = (chunk: any, ...args: any[]) => {
    if (chunk && chunk !== null) {
      output.stdout += chunk.toString();
    }
    return originalStdoutWrite(chunk, ...args);
  };

  const originalStderrWrite = stderrStream.write.bind(stderrStream);
  stderrStream.write = (chunk: any, ...args: any[]) => {
    if (chunk && chunk !== null) {
      output.stderr += chunk.toString();
    }
    return originalStderrWrite(chunk, ...args);
  };

  const stdinStream = new PassThrough();
  stdinStream.pause(); // Prevents sending EOF to the process

  return {
    pid: -1, // Nonexistent when starting process
    status: 'running',
    stdinStream,
    stdoutStream,
    stderrStream,
    output,
    get stdout() { return output.stdout; },
    get stderr() { return output.stderr; },
    createdAt: new Date(),
    command,
    cwd,
    env,
    tty,
  };
}
