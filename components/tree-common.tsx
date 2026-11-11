// components/tree-common.tsx
//
// Small pieces shared by the family tree and the first-visit details form:
// the data the tree page receives, how a birth date is shown, a person's photo,
// and shrinking a chosen picture in the browser.

import type { PublicTreeNode, TreeNode } from "@/lib/family-tree";

export interface TreeData {
  nodes: PublicTreeNode[];
  me: { memberId: string | null; name: string; nodeId: string | null };
  isAdmin: boolean;
  editableIds: string[];
  addChildIds: string[];
  canAddParent: boolean;
  needsToConnect: boolean;
  /** The member has not filled in their details yet (asked once, the first time they open the tree). */
  needsProfile: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function born(node: PublicTreeNode): string | null {
  if (node.dateOfBirth) {
    const [y, m, d] = node.dateOfBirth.split("-").map(Number);
    const now = new Date();
    let age = now.getFullYear() - y;
    if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
    return `Born ${d} ${MONTHS[m - 1]} ${y} (${age})`;
  }
  return node.birthdate ? `Born ${node.birthdate}` : null;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** The nodes as the pure tree functions expect them. */
export function asTreeNodes(nodes: PublicTreeNode[]): TreeNode[] {
  return nodes.map((n) => ({ ...n, deletedAt: null }));
}

/** Shrinks a chosen picture to a small square JPEG in the browser, so only a few kilobytes are stored. */
export async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That picture could not be opened."));
      el.src = url;
    });
    const size = 200;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser cannot prepare pictures.");
    const side = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function Photo({ node, size = 46 }: { node: PublicTreeNode; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size / 3) };
  if (node.hasPhoto) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="fphoto" style={style} src={`/api/tree/${node.id}/photo?v=${encodeURIComponent(node.updatedAt)}`} alt="" />;
  }
  return (
    <span className="fphoto" style={style} aria-hidden>
      {initials(node.name)}
    </span>
  );
}
