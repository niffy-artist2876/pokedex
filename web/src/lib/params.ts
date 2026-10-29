export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function param(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? "").trim();
}

export function positiveInt(value: string | string[] | undefined): number | null {
  const n = Number(param(value));
  return Number.isInteger(n) && n > 0 ? n : null;
}
