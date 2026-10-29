import Link from "next/link";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/formats", label: "Formats & bans" },
  { href: "/admin/trainers", label: "Trainers" },
  { href: "/admin/embeddings", label: "Descriptions & embeddings" },
];

export function AdminNav({ current }: { current: string }) {
  return (
    <nav className="mb-6 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`rounded-md px-3 py-1.5 text-sm ${current === l.href ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
