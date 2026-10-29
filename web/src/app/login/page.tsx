import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { login } from "@/app/actions/auth";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, inputClass } from "@/components/ui";

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm">
      <Suspense>
        <RedirectIfSignedIn />
      </Suspense>
      <Card title="Log in">
        <ActionForm action={login} submitLabel="Log in">
          <Field label="Username or e-mail">
            <input name="login" required autoComplete="username" className={inputClass} />
          </Field>
          <Field label="Password">
            <input name="password" type="password" required autoComplete="current-password" className={inputClass} />
          </Field>
        </ActionForm>
        <p className="mt-4 text-sm text-slate-600">
          New here? <Link href="/signup" className="text-red-700 hover:underline">Create an account</Link>
        </p>
      </Card>
    </div>
  );
}

async function RedirectIfSignedIn() {
  if (await getCurrentUser()) redirect("/teams");
  return null;
}
