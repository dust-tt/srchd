import assert from "assert";
import { isString } from "./utils";

/**
 * A Result is a type that can be either Ok or Err. The main motivation behind this utils is to
 * overcome the fact that Javascript does not let you check the type of an object at runtime, so you
 * cannot know if a function returned an error type or a success type.
 *
 * Usage:
 * ```
 * import {Result, Ok, Err} from "@app/lib/result"
 * function divide(numerator: number, denominator: number) : Result<number, Error> {
 *   if (denominator === 0) {
 *     return new Err(new Error("Cannot divide by zero"));
 *   }
 *   return ok(numerator / denominator);
 * }
 * ```
 */

export class Ok<T> {
  constructor(public value: T) {}

  isOk(): this is Ok<T> {
    return true;
  }

  isErr(): this is Err<never> {
    return false;
  }
}

export class Err<E> {
  constructor(public error: E) {}

  isOk(): this is Ok<never> {
    return false;
  }

  isErr(): this is Err<E> {
    return true;
  }
}

export type Result<T> = Ok<T> | Err<SrchdError>;

export type ErrorCode =
  | "invalid_parameters_error"
  | "reading_file_error"
  | "copy_file_error"
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
  | "pod_run_error"
  | "computer_run_error"
  | "pod_timeout_error"
  | "image_error"
  | "web_fetch_error"
  | "web_search_error"
  | "pod_deletion_error"
  | "pod_initialization_error"
  | "namespace_deletion_error"
  | "port_forward_error"
  | "string_edit_error";

export class SrchdError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly cause?: Error | null,
  ) {
    super(message);
  }
}

export function ok<T>(value: T): Ok<T> {
  return new Ok(value);
}

export function err(
  code: ErrorCode,
  message: string,
  cause?: Error | null,
): Err<SrchdError> {
  return new Err(new SrchdError(code, message, cause));
}

export function errorToString(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  } else if (isString(error)) {
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
  fn: (arg: T) => Promise<Result<U>>,
  {
    retries = 3,
    delayBetweenRetriesMs = 3000,
    retriableCodes = undefined,
  }: RetryOptions = {},
): (arg: T) => Promise<Result<U>> {
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
