// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecLight } from "./interview-ui";

describe("RecLight", () => {
  it("mostra REC somente enquanto a gravação está efetivamente ativa", () => {
    const { rerender } = render(<RecLight active={false} />);
    expect(screen.getByText("EM ESPERA")).toBeTruthy();
    expect(screen.queryByText("REC")).toBeNull();
    rerender(<RecLight active />);
    expect(screen.getByText("REC")).toBeTruthy();
  });
});
