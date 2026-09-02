import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar";
import { StatusBadge } from "./StatusBadge";

describe("ProgressBar", () => {
  it("exposes progress semantics and the visible percentage", () => {
    render(<ProgressBar value={47.6} label="Progresso do teste" />);

    const progressbar = screen.getByRole("progressbar", {
      name: "Progresso do teste",
    });
    expect(progressbar).toHaveAttribute("aria-valuenow", "48");
    expect(progressbar).toHaveAttribute("aria-valuetext", "48% concluído");
    expect(screen.getByText("48%")).toBeVisible();
  });

  it("clamps invalid and out-of-range values", () => {
    const { rerender } = render(<ProgressBar value={180} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );

    rerender(<ProgressBar value={Number.NaN} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });
});

describe("StatusBadge", () => {
  it("uses text in addition to color to communicate status", () => {
    render(<StatusBadge status="RUNNING" />);
    expect(screen.getByText("Em execução")).toBeVisible();
  });
});
