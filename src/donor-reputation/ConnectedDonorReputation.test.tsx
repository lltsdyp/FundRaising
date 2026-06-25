import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ConnectedDonorReputation } from "./ConnectedDonorReputation";

const sampleAddress = "0x0000000000000000000000000000000000000abc";

function renderToHost(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return {
    host,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("ConnectedDonorReputation", () => {
  it("prompts to connect a wallet when no address is provided", () => {
    const { host, cleanup } = renderToHost(<ConnectedDonorReputation />);

    expect(host.textContent).toContain("请先连接钱包");

    cleanup();
  });

  it("shows the contribution score, level, metrics and disclaimer when connected", () => {
    const { host, cleanup } = renderToHost(
      <ConnectedDonorReputation address={sampleAddress} />,
    );

    // mock 数据计算后的分数：12*10 + 8.4*20 + 21*5 + 15*8 + 100 = 613 -> Genesis
    expect(host.textContent).toContain("613");
    expect(host.textContent).toContain("Genesis");
    expect(host.textContent).toContain("累计支持项目");
    expect(host.textContent).toContain("可解锁特权预览");
    expect(host.textContent).toContain("仅用于展示");

    cleanup();
  });
});
