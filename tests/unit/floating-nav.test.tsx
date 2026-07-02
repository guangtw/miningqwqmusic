import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FloatingNav } from "@/src/components/immersive/floating-nav";

describe("FloatingNav", () => {
  it("exposes the primary destinations as accessible icon buttons", () => {
    render(
      <FloatingNav
        active="home"
        onSelect={vi.fn()}
        onProfile={vi.fn()}
        onSettings={vi.fn()}
      />
    );

    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "首页" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "搜索" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "音乐库" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "一起听" })).toBeInTheDocument();
    expect(screen.queryByText("MiningQwQ Music")).not.toBeInTheDocument();
  });

  it("routes destination and utility actions through explicit callbacks", () => {
    const onSelect = vi.fn();
    const onProfile = vi.fn();
    const onSettings = vi.fn();

    render(
      <FloatingNav
        active="search"
        onSelect={onSelect}
        onProfile={onProfile}
        onSettings={onSettings}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "音乐库" }));
    fireEvent.click(screen.getByRole("button", { name: "个人中心" }));
    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    expect(onSelect).toHaveBeenCalledWith("library");
    expect(onProfile).toHaveBeenCalledTimes(1);
    expect(onSettings).toHaveBeenCalledTimes(1);
  });
});
