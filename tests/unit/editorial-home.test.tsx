import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorialHome } from "@/src/components/immersive/editorial-home";

const items = [
  { id: "one", title: "午夜之后", subtitle: "夜行精选", coverUrl: "/one.jpg" },
  { id: "two", title: "深夜回声", subtitle: "城市氛围", coverUrl: "/two.jpg" }
];

describe("EditorialHome", () => {
  it("uses one editorial hero followed by focused content rails", () => {
    render(
      <EditorialHome
        hero={items[0]}
        featured={items}
        recent={items.slice().reverse()}
        onSelect={vi.fn()}
        onMore={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "午夜之后" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "为你精选" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "继续探索" })).toBeInTheDocument();
    expect(screen.queryByText("DISCOVER MIX")).not.toBeInTheDocument();
  });

  it("opens the selected editorial item", () => {
    const onSelect = vi.fn();
    render(
      <EditorialHome
        hero={items[0]}
        featured={items}
        recent={[]}
        onSelect={onSelect}
        onMore={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /播放精选：午夜之后/ }));
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it("offers a direct search action when recommendations are unavailable", () => {
    const onExplore = vi.fn();
    render(
      <EditorialHome
        featured={[]}
        recent={[]}
        onSelect={vi.fn()}
        onMore={vi.fn()}
        onExplore={onExplore}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "搜索音乐" }));
    expect(onExplore).toHaveBeenCalledTimes(1);
  });
});
