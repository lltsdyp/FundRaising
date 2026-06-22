import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BadgeGallery, type DisplayBadge } from "./BadgeGallery";

const badges: DisplayBadge[] = [
  {
    tokenId: 1n,
    project: "0x1111111111111111111111111111111111111111",
    projectTitle: "乡村图书角",
    rank: 1,
    tier: "gold",
    tokenUri: "data:application/json,{}",
  },
  {
    tokenId: 2n,
    project: "0x2222222222222222222222222222222222222222",
    projectTitle: "社区花园",
    rank: 2,
    tier: "silver",
    tokenUri: "data:application/json,{}",
  },
  {
    tokenId: 3n,
    project: "0x3333333333333333333333333333333333333333",
    projectTitle: "开源助学",
    rank: 3,
    tier: "bronze",
    tokenUri: "data:application/json,{}",
  },
];

let host: HTMLDivElement | undefined;
let root: Root | undefined;

function renderGallery(
  props: Partial<React.ComponentProps<typeof BadgeGallery>> = {},
) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);

  act(() => {
    root?.render(
      <BadgeGallery
        badges={badges}
        loading={false}
        error=""
        onOpenProject={() => undefined}
        {...props}
      />,
    );
  });

  return host;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

describe("BadgeGallery", () => {
  it("renders ranked medal cards with project details", () => {
    const view = renderGallery();
    const cards = Array.from(view.querySelectorAll<HTMLButtonElement>("button"));

    expect(view.querySelector("h3")?.textContent).toBe("早期支持者徽章");
    expect(view.querySelector(".badge-count")?.textContent).toContain("3");
    expect(cards).toHaveLength(3);
    expect(cards.map((card) => card.type)).toEqual(["button", "button", "button"]);
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
      "打开项目 乡村图书角，早期支持者 #1",
      "打开项目 社区花园，早期支持者 #2",
      "打开项目 开源助学，早期支持者 #3",
    ]);
    expect(cards.map((card) => card.classList.contains("gold"))).toContain(true);
    expect(cards.map((card) => card.classList.contains("silver"))).toContain(true);
    expect(cards.map((card) => card.classList.contains("bronze"))).toContain(true);
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("#1"),
      expect.stringContaining("#2"),
      expect.stringContaining("#3"),
    ]);
    expect(view.textContent).toContain("乡村图书角");
    expect(view.textContent).toContain("0x1111...1111");
  });

  it("opens the project represented by a clicked badge", () => {
    const onOpenProject = vi.fn();
    const view = renderGallery({ onOpenProject });
    const silverBadge = view.querySelector<HTMLButtonElement>("button.silver");

    act(() => silverBadge?.click());

    expect(onOpenProject).toHaveBeenCalledOnce();
    expect(onOpenProject).toHaveBeenCalledWith(badges[1].project);
  });

  it("renders a standalone loading state", () => {
    const view = renderGallery({ badges: [], loading: true });

    expect(view.textContent).toContain("正在加载徽章");
    expect(view.querySelector('[role="status"]')).not.toBeNull();
    expect(view.querySelector('[role="alert"]')).toBeNull();
    expect(view.querySelector(".badge-grid")).toBeNull();
  });

  it("renders a standalone error state", () => {
    const view = renderGallery({ badges: [], error: "徽章读取失败" });

    expect(view.textContent).toContain("徽章读取失败");
    expect(view.querySelector('[role="alert"]')).not.toBeNull();
    expect(view.querySelector('[role="status"]')).toBeNull();
    expect(view.querySelector(".badge-grid")).toBeNull();
  });

  it("renders a standalone empty state", () => {
    const view = renderGallery({ badges: [] });

    expect(view.textContent).toContain("暂无早期支持者徽章");
    expect(view.querySelector('[role="alert"]')).toBeNull();
    expect(view.querySelector('[role="status"]')).toBeNull();
    expect(view.querySelector(".badge-grid")).toBeNull();
  });
});
