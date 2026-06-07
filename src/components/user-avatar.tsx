"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import type { AccountUser } from "@/src/types/account";

export function UserAvatar({
  user,
  size = "md",
  className = ""
}: {
  user: AccountUser | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const label = user?.nickname?.trim() || user?.email || "游客";
  const fallbackText = user?.avatarFallbackText || label.trim().slice(0, 1).toUpperCase() || "U";
  const fallbackBg = user?.avatarFallbackBg || "#22c55e";
  return (
    <span
      className={`user-avatar user-avatar-${size} ${className}`.trim()}
      style={{ "--avatar-bg": fallbackBg } as CSSProperties}
      aria-label={`${label} 的头像`}
      title={label}
    >
      {user?.avatarUrl ? <Image src={user.avatarUrl} alt="" width={64} height={64} unoptimized /> : <span>{fallbackText}</span>}
    </span>
  );
}
