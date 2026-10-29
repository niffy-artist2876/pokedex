import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { NavLinks, UserMenu } from "@/components/Nav";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Pokédex Team Lab",
  description: "Browse Pokémon, build competitive teams and validate them against tournament formats.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-bold text-red-600">
              <span className="inline-block h-5 w-5 rounded-full border-4 border-slate-900 bg-[linear-gradient(to_bottom,#dc2626_45%,#0f172a_45%,#0f172a_55%,#fff_55%)]" />
              Pokédex Team Lab
            </Link>
            <Suspense fallback={<nav className="flex-1" />}>
              <NavLinks />
            </Suspense>
            <Suspense fallback={null}>
              <UserMenu />
            </Suspense>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-500">
          Data from PokeAPI · PostgreSQL + pgvector · DBMS mini project
        </footer>
      </body>
    </html>
  );
}
