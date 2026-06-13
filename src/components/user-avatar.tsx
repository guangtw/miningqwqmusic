"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { getSizedImageUrl } from "@/src/lib/image-url";
import type { AccountUser } from "@/src/types/account";

const AVATAR_SIZE_PX = {
  sm: 40,
  md: 64,
  lg: 88
} as const;

const AVATAR_SIZES = {
  sm: "40px",
  md: "64px",
  lg: "88px"
} as const;

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
  const sizePx = AVATAR_SIZE_PX[size];
  const avatarUrl = getSizedImageUrl(user?.avatarUrl, {
    width: sizePx,
    height: sizePx
  });
  return (
    <span
      className={`user-avatar user-avatar-${size} ${className}`.trim()}
      style={{ "--avatar-bg": fallbackBg } as CSSProperties}
      aria-label={`${label} 的头像`}
      title={label}
    >
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt=""
          width={sizePx}
          height={sizePx}
          sizes={AVATAR_SIZES[size]}
        />
      ) : (
        <span>{fallbackText}</span>
      )}
    </span>
  );
}
