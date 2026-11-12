// components/AppNav.tsx
//
// The links at the top right of every page a logged-in person uses:
// Dashboard, Family tree, Board, (Admin), Log out. One component so the
// pages can never disagree about what the menu contains.

import LogoutButton from "@/components/LogoutButton";

type Page = "dashboard" | "ledger" | "tree";

export default function AppNav({ isAdmin, isMember, current, familyOnly = false }: { isAdmin: boolean; isMember: boolean; current: Page; familyOnly?: boolean }) {
  const link = (href: string, label: string, page: Page) => (
    <a href={href} className={current === page ? "link font-medium underline" : "link"}>
      {label}
    </a>
  );
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-sm">
      {!familyOnly && link("/", "Dashboard", "dashboard")}
      {link("/tree", "Family tree", "tree")}
      {isAdmin && (
        <a href="/admin" className="link">
          Admin
        </a>
      )}
      <LogoutButton type={isMember ? "member" : "admin"} />
    </div>
  );
}
