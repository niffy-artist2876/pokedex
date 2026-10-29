"use client";

import { startTransition, useActionState, type ReactNode } from "react";
import type { ActionState, FormAction } from "@/lib/action-state";

const BUTTON_STYLES = {
  primary: "bg-red-600 text-white hover:bg-red-700",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
  danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50",
};

/**
 * A form bound to a server action. Shows the action's error or success message
 * (database constraint and trigger errors come back here) and a pending state.
 * Once hydrated it submits through a transition instead of letting React run the
 * form action, because React resets an action form's fields afterwards, which
 * would wipe the input on an error. `action` stays for submits before hydration.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  variant = "primary",
  confirmMessage,
  className = "",
  inline = false,
}: {
  action: FormAction;
  submitLabel: string;
  children?: ReactNode;
  variant?: keyof typeof BUTTON_STYLES;
  confirmMessage?: string;
  className?: string;
  inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        event.preventDefault();
        if (confirmMessage && !window.confirm(confirmMessage)) return;
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
      className={inline ? `inline-flex flex-wrap items-center gap-2 ${className}` : `space-y-3 ${className}`}
    >
      {children}
      <div className={inline ? "contents" : "flex flex-wrap items-center gap-3"}>
        <button
          type="submit"
          disabled={pending}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-60 ${BUTTON_STYLES[variant]}`}
        >
          {pending ? "Working…" : submitLabel}
        </button>
        {state.error && (
          <p role="alert" className="text-sm text-red-700">
            {state.error}
          </p>
        )}
        {state.message && <p className="text-sm text-emerald-700">{state.message}</p>}
      </div>
    </form>
  );
}
