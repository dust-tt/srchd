import assert from "assert";
import { Err, Result } from "./result";

export type ErrorCode =
  | "invalid_parameters_error"
  | "reading_file_error"
  | "not_found_error"
  | "reference_not_found_error"
  | "experiment_error"
  | "publication_error"
  | "model_error"
  | "tool_error"
  | "resource_creation_error"
  | "resource_update_error"
  | "agent_loop_overflow_error"
  | "tool_execution_error"
  | "tool_not_found_error"
  | "computer_run_error"
  | "computer_timeout_error"
  | "web_fetch_error"
  | "web_search_error"
  | "string_edit_error";

export class SrchdError<T extends ErrorCode = ErrorCode> extends Error {
  constructor(
    readonly code: T,
    message: string,
    readonly cause?: Error | null,
  ) {
    super(message);
  }
}

export function errorToString(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  } else if (typeof error === "string") {
    return error;
  }

  return JSON.stringify(error);
}

export function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(errorToString(error));
}

type RetryOptions = {
  retries?: number;
  delayBetweenRetriesMs?: number;
  retriableCodes?: ErrorCode[];
};

export function withRetries<T, U>(
  fn: (arg: T) => Promise<Result<U, SrchdError>>,
  {
    retries = 3,
    delayBetweenRetriesMs = 3000,
    retriableCodes = undefined,
  }: RetryOptions = {},
): (arg: T) => Promise<Result<U, SrchdError>> {
  assert(retries >= 1);

  return async (arg) => {
    const errors: SrchdError[] = [];

    for (let i = 0; i < retries; i++) {
      const res = await fn(arg);
      if (res.isOk()) {
        return res;
      } else {
        if (
          Array.isArray(retriableCodes) &&
          !retriableCodes.includes(res.error.code)
        ) {
          return new Err(res.error);
        }
        const sleepTime = delayBetweenRetriesMs * (i + 1) ** 2;
        console.warn(
          `RETRY: error=${res.error.code} attempt=${i + 1}/${retries} sleepTime=${sleepTime}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, sleepTime));
        errors.push(res.error);
      }
    }

    const [error] = errors;
    return new Err(error);
  };
}
