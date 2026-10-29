export type ActionState = { error?: string; message?: string };

export type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export function int(formData: FormData, name: string): number | null {
  const value = text(formData, name);
  if (value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}
