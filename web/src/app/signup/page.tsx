import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { signup } from "@/app/actions/auth";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, inputClass } from "@/components/ui";

export default function SignupPage() {
  return (
    <div className="mx-auto max-w-sm">
      <Suspense>
        <RedirectIfSignedIn />
      </Suspense>
      <Card title="Create an account">
        <ActionForm action={signup} submitLabel="Sign up">
          <Field label="Username" hint="3-40 letters, digits or underscores">
            <input name="username" required autoComplete="username" className={inputClass} />
          </Field>
          <Field label="E-mail">
            <input name="email" type="email" required autoComplete="email" className={inputClass} />
          </Field>
          <Field label="Password" hint="At least 8 characters">
            <input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
          </Field>
          <Field label="Confirm password">
            <input name="confirm" type="password" required autoComplete="new-password" className={inputClass} />
          </Field>
        </ActionForm>
        <p className="mt-4 text-sm text-slate-600">
          Already registered? <Link href="/login" className="text-red-700 hover:underline">Log in</Link>
        </p>
      </Card>
    </div>
  );
}

async function RedirectIfSignedIn() {
  if (await getCurrentUser()) redirect("/teams");
  return null;
}
