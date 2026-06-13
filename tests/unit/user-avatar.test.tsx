import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserAvatar } from "@/src/components/user-avatar";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => <img {...props} />
}));

describe("UserAvatar", () => {
  it("uses optimized avatar sizing for small avatars", () => {
    const { container } = render(
      <UserAvatar
        user={{
          id: "u1",
          email: "user@example.com",
          avatarUrl: "https://p1.music.126.net/avatar.jpg"
        }}
        size="sm"
      />
    );

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute("src", "https://p1.music.126.net/avatar.jpg?param=40y40");
    expect(image).toHaveAttribute("width", "40");
    expect(image).toHaveAttribute("height", "40");
    expect(image).toHaveAttribute("sizes", "40px");
    expect(image).not.toHaveAttribute("unoptimized");
  });

  it("falls back to initials when avatar url is absent", () => {
    render(
      <UserAvatar
        user={{
          id: "u2",
          email: "guest@example.com",
          nickname: "访客"
        }}
      />
    );

    expect(screen.getByText("访")).toBeInTheDocument();
  });
});
