"use client";
// components/OtherIncomeNotes.tsx
//
// The notes section under the main ledger. The ledger above shows only
// members' MONTHLY contributions, so this lists the money in the account
// that is not part of anyone's monthly dues (boosters, recoveries,
// donations, stray payments sent to the Till by mistake, and payments
// still waiting to be matched to a member), and shows how everything
// adds up to the Total in account.

import { useEffect, useState } from "react";
import { summariseOtherIncome, type FullLedger, type OtherIncomeSummary } from "@/lib/full-ledger";

const SHOWN = 10;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
function amount(n: number): string {
  return Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
}

export default function OtherIncomeNotes() {
  const [summary, setSummary] = useState<OtherIncomeSummary | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/ledger/full");
        if (!res.ok) return;
        const data = await res.json();
        setSummary(summariseOtherIncome(data.ledger as FullLedger));
      } catch {
        /* a notes section is a convenience: if it cannot load, the ledger above still works */
      }
    })();
  }, []);

  if (!summary) return null;
  const shown = summary.items.slice(0, SHOWN);

  return (
    <div className="border-t border-line px-4 py-4 text-sm">
      <h3 className="font-medium">Other income and notes</h3>
      <p className="mt-1 text-xs text-ink-soft">
        The ledger above shows only members&apos; monthly contributions. This is money that is also in the account but is not part of anyone&apos;s
        monthly dues: extra contributions (boosters), recoveries, donations, stray payments sent to the Till by mistake, and payments still waiting to be
        matched to a member. All of it is included in the Total in account.
      </p>

      {shown.length === 0 ? (
        <p className="mt-3 text-xs text-ink-soft">No other income so far.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {shown.map((e, i) => (
                <tr key={e.id} className={i > 0 ? "border-t border-line" : ""}>
                  <td className="whitespace-nowrap py-1.5 pr-3 align-top text-xs text-ink-soft">{shortDate(e.date)}</td>
                  <td className="py-1.5 pr-3 align-top">
                    {e.awaitingMember ? "Payment waiting to be matched to a member" : e.label}
                    {e.detail && !e.awaitingMember && <span className="block text-xs text-ink-soft">{e.detail}</span>}
                    {e.awaitingMember && <span className="block text-xs text-ink-soft">Counted in the total, not yet in a member&apos;s ledger</span>}
                  </td>
                  <td className="figures whitespace-nowrap py-1.5 text-right align-top font-medium" style={{ color: "var(--forest)" }}>
                    +{amount(e.money)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.items.length > SHOWN && (
            <p className="mt-1 text-xs text-ink-soft">
              {summary.items.length - SHOWN} older item(s) are in the <a href="/ledger" className="link">full ledger</a>.
            </p>
          )}
          <p className="mt-2 text-xs">
            Other income total: <span className="figures font-medium">KES {amount(summary.total)}</span>
          </p>
        </div>
      )}

      <p className="figures mt-3 rounded-md border border-line bg-paper px-3 py-2 text-xs">
        How the Total in account adds up: monthly contributions KES {amount(summary.monthlyContributions)} + other income KES {amount(summary.total)}
        {summary.openingAndAdjustments !== 0 && (
          <>
            {" "}
            {summary.openingAndAdjustments > 0 ? "+" : "-"} opening balance and adjustments KES {amount(summary.openingAndAdjustments)}
          </>
        )}{" "}
        - withdrawals and charges KES {amount(summary.spent)} = <strong>KES {amount(summary.balance)}</strong>
      </p>
    </div>
  );
}
