import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StageEmpty, StagePanelShell, StageSection } from "@/src/components/immersive/stage-panel";

vi.mock("motion/react", async () => {
  const React = await import("react");
  const passthrough = ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement("div", props, children);
  const button = ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement("button", props, children);
  const section = ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement("section", props, children);
  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    motion: {
      div: passthrough,
      button,
      section
    },
    useReducedMotion: () => true
  };
});

describe("StagePanelShell", () => {
  it("renders side nav and focuses one stage at a time", () => {
    const onNav = vi.fn();
    render(
      <StagePanelShell
        title="一起听"
        kicker="Social Listening"
        description="协作听歌"
        onClose={vi.fn()}
        nav={[
          { id: "room", label: "房间" },
          { id: "friends", label: "好友", count: 3 },
          { id: "activity", label: "动态", count: 2 }
        ]}
        activeNav="room"
        onNav={onNav}
        navAriaLabel="一起听功能标签"
        stageKey="room"
      >
        <StageSection title="开始一起听" hint="创建或加入">
          <button type="button">创建一起听</button>
        </StageSection>
      </StagePanelShell>
    );

    expect(screen.getByRole("heading", { name: "一起听" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "房间" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /好友/ })).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /动态/ }));
    expect(onNav).toHaveBeenCalledWith("activity");
  });

  it("shows empty state helper", () => {
    render(<StageEmpty title="暂无邀请" description="等待好友邀请" />);
    expect(screen.getByText("暂无邀请")).toBeInTheDocument();
    expect(screen.getByText("等待好友邀请")).toBeInTheDocument();
  });
});
