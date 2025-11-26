export function removeNulls<T>(arr: (T | null | undefined)[]): T[] {
  return arr.filter((v): v is T => v !== null && v !== undefined);
}

export function newID4(): string {
  return Math.random().toString(36).substring(2, 6);
}

export function isArrayOf<T>(
  arr: unknown,
  tg: (v: unknown) => v is T,
): arr is T[] {
  return Array.isArray(arr) && arr.every(tg);
}

export function isString(str: unknown): str is string {
  return typeof str === "string";
}
