import Link from "next/link";
import type { ReactNode } from "react";

const TYPE_COLORS: Record<string, string> = {
  Normal: "#9fa19f", Fire: "#e62829", Water: "#2980ef", Electric: "#fac000", Grass: "#3fa129",
  Ice: "#3dcef3", Fighting: "#ff8000", Poison: "#9141cb", Ground: "#915121", Flying: "#81b9ef",
  Psychic: "#ef4179", Bug: "#91a119", Rock: "#afa981", Ghost: "#704170", Dragon: "#5060e1",
  Dark: "#624d4e", Steel: "#60a1b8", Fairy: "#ef70ef",
};

export function TypeBadge({ type }: { type: string | null }) {
  if (!type) return null;
  return (
    <span
      className="inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white"
      style={{ backgroundColor: TYPE_COLORS[type] ?? "#777" }}
    >
      {type}
    </span>
  );
}

export function Sprite({ id, name, size = 96 }: { id: number; name: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 700+ tiny remote sprites; no optimisation needed
    <img
      src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      className="[image-rendering:pixelated]"
    />
  );
}

export const STAT_LABELS: Record<string, string> = {
  hit_points: "HP", attack: "Attack", defense: "Defense",
  special_attack: "Sp. Atk", special_defense: "Sp. Def", speed: "Speed",
};

export function StatBar({ label, value, max = 255 }: { label: string; value: number; max?: number }) {
  const pct = Math.min(100, (value / max) * 100);
  const color = value >= 120 ? "bg-emerald-500" : value >= 80 ? "bg-lime-500" : value >= 50 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="grid grid-cols-[5.5rem_3rem_1fr] items-center gap-2 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="text-right font-mono tabular-nums">{value}</span>
      <div className="h-2 rounded bg-slate-100">
        <div className={`h-2 rounded ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function PageTitle({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight">{children}</h1>
      {subtitle && <p className="mt-1 text-slate-600">{subtitle}</p>}
    </div>
  );
}

export function Card({ children, className = "", title }: { children: ReactNode; className?: string; title?: ReactNode }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {title && <h2 className="mb-3 font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const styles = status === "validated" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>{status}</span>;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <p className="animate-pulse py-8 text-center text-slate-500">{label}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-slate-500">{children}</p>;
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-red-700 hover:underline">
      {children}
    </Link>
  );
}

export const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function multiplierLabel(m: number) {
  return m === 0.25 ? "¼×" : m === 0.5 ? "½×" : `${m}×`;
}
