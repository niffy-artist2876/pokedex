import Link from "next/link";
import { StatusBadge } from "@/components/ui";

export type TeamOverview = {
  team_id: number; team_name: string; team_status: string; owner_id: number; owner_username: string;
  format_id: number; format_name: string; member_count: number; average_level: number | null;
  legendary_members: number; roster: string | null;
};

export function TeamCard({ team: t, showOwner = false }: { team: TeamOverview; showOwner?: boolean }) {
  return (
    <li>
      <Link href={`/teams/${t.team_id}`} className="block h-full rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-red-300">
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold">{t.team_name}</span>
          <StatusBadge status={t.team_status} />
        </div>
        <p className="text-sm text-slate-600">
          {t.format_name}
          {showOwner && <> · by {t.owner_username}</>}
        </p>
        <p className="mt-2 text-sm">{t.roster ?? <span className="text-slate-400">no members yet</span>}</p>
        <p className="mt-1 text-xs text-slate-500">
          {t.member_count}/6 members{t.legendary_members > 0 && ` · ${t.legendary_members} legendary`}
        </p>
      </Link>
    </li>
  );
}
