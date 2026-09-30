"use client";
// components/admin/AdminShell.tsx
//
// Setup, Members and Payments used to be three separate pages; they're
// now tabs on one page, so switching between them is a click instead of
// a navigation. Each tab's content is still its own component
// (SetupForm / MembersManager / PaymentsManager) — only the shell
// around them changed.

import { useState } from "react";
import SetupForm from "./SetupForm";
import MembersManager from "./MembersManager";
import PaymentsManager from "./PaymentsManager";

type Tab = "setup" | "members" | "payments";

const TABS: { key: Tab; label: string }[] = [
  { key: "members", label: "Members" },
  { key: "payments", label: "Payments" },
  { key: "setup", label: "Setup" },
];

export default function AdminShell() {
  const [tab, setTab] = useState<Tab>("members");

  return (
    <div>
      <div className="ledger-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className="ledger-tab"
            data-active={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="ledger-panel p-4 sm:p-6">
        {tab === "members" && <MembersManager />}
        {tab === "payments" && <PaymentsManager />}
        {tab === "setup" && <SetupForm />}
      </div>
    </div>
  );
}
