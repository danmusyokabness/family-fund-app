"use client";
// components/PayHelper.tsx
//
// "Pay my contribution": works out how much to send for a number of months and
// shows exactly where to send it. It never moves money by itself: the member
// pays from their own phone (M-PESA, Lipa na M-PESA, Buy Goods and Services).
// The payment shows up after the next statement import.

import { useState } from "react";
import { defaultMonths, MAX_PAY_MONTHS, monthsOwed, MPESA_MENU_LINK, payAmount } from "@/lib/pay";

function money(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function PayHelper({ balance, targetAmount, tillNumber }: { balance: number; targetAmount: number; tillNumber: string }) {
  const owed = monthsOwed(balance, targetAmount);
  const [months, setMonths] = useState(defaultMonths(balance, targetAmount));
  const [copied, setCopied] = useState<string | null>(null);
  const amount = payAmount(months, balance, targetAmount);

  async function copy(what: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000);
    } catch {
      /* copying is a convenience; the numbers are on the screen */
    }
  }

  if (!(targetAmount > 0) || !tillNumber) return null;

  return (
    <details className="paper-card p-4" open={owed > 0}>
      <summary className="cursor-pointer font-medium">
        Pay my contribution
        {owed > 0 ? <span className="ml-2 text-sm font-normal" style={{ color: "var(--ochre)" }}>{owed} month{owed === 1 ? "" : "s"} owed</span> : <span className="ml-2 text-sm font-normal text-ink-soft">you are up to date</span>}
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <label className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-soft">How many months?</span>
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="px-2 py-1 text-sm">
            {Array.from({ length: MAX_PAY_MONTHS }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m}
                {owed > 0 && m === owed ? " (what you owe)" : owed > 0 && m > owed ? " (some in advance)" : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-md border border-line p-3">
            <p className="text-xs text-ink-soft">Amount to send</p>
            <p className="figures font-serif text-2xl font-semibold">KES {money(amount)}</p>
            <button type="button" className="link mt-1 text-xs" onClick={() => copy("amount", String(amount))}>
              {copied === "amount" ? "Copied" : "Copy amount"}
            </button>
          </div>
          <div className="rounded-md border border-line p-3">
            <p className="text-xs text-ink-soft">Till number</p>
            <p className="figures font-serif text-2xl font-semibold">{tillNumber}</p>
            <button type="button" className="link mt-1 text-xs" onClick={() => copy("till", tillNumber)}>
              {copied === "till" ? "Copied" : "Copy Till number"}
            </button>
          </div>
        </div>

        <ol className="list-decimal space-y-0.5 pl-5 text-xs text-ink-soft">
          <li>
            Open M-PESA on your phone (or <a href={MPESA_MENU_LINK} className="link">tap here to open the M-PESA menu</a>).
          </li>
          <li>Choose Lipa na M-PESA, then Buy Goods and Services.</li>
          <li>Enter the Till number and the amount above, then your PIN.</li>
        </ol>
        <p className="text-xs text-ink-soft">
          The site cannot take the money for you, and your payment appears here after the admin imports the next statement, usually within a few days.
        </p>
      </div>
    </details>
  );
}
