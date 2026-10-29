import { Field, inputClass } from "@/components/ui";

export type FormatValues = {
  format_name: string; level_cap: number; ruleset_description: string | null; minimum_team_size: number;
  maximum_legendary_members: number | null; is_active: boolean;
};

export function FormatFields({ format }: { format?: FormatValues }) {
  return (
    <>
      <Field label="Name">
        <input name="name" required maxLength={80} defaultValue={format?.format_name} className={inputClass} />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Level cap">
          <input name="level_cap" type="number" min={1} max={100} required defaultValue={format?.level_cap ?? 50} className={inputClass} />
        </Field>
        <Field label="Min. team">
          <input name="min_team_size" type="number" min={1} max={6} required defaultValue={format?.minimum_team_size ?? 1} className={inputClass} />
        </Field>
        <Field label="Max legends">
          <input name="max_legendaries" type="number" min={0} max={6} placeholder="any" defaultValue={format?.maximum_legendary_members ?? ""} className={inputClass} />
        </Field>
      </div>
      <Field label="Rules">
        <textarea name="rules" rows={3} defaultValue={format?.ruleset_description ?? ""} className={inputClass} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={format?.is_active ?? true} /> Active (new teams can use it)
      </label>
    </>
  );
}
