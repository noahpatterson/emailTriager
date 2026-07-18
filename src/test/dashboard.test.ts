import { describe, expect, it } from "bun:test";
import { formatRunTime, runMessage, type RunStatus } from "../../app/run-status";

describe("owner dashboard run states", () => {
  it("explains every supported run status without message content", () => {
    const statuses: RunStatus[] = ["running", "bounded_incomplete", "completed", "partial_failure", "failed"];
    for (const status of statuses) {
      const message = runMessage(status);
      expect(message.length).toBeGreaterThan(20);
      expect(message.toLowerCase()).not.toContain("body excerpt");
    }
  });

  it("makes bounded completion explicitly resumable", () => {
    const message = runMessage("bounded_incomplete");
    expect(message).toContain("safety limit");
    expect(message).toContain("saved checkpoint");
  });

  it("describes failures conservatively", () => {
    expect(runMessage("failed")).toContain("No unclassified message was moved");
    expect(runMessage("partial_failure")).toContain("Other messages were handled normally");
  });

  it("renders malformed timestamps without throwing", () => {
    expect(formatRunTime("not-a-date")).toBe("Time unavailable");
    expect(formatRunTime("2026-07-18T12:00:00.000Z")).not.toBe("Time unavailable");
  });
});
