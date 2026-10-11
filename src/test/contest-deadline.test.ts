import { describe, expect, test } from "bun:test";
import { extractContestClaimDeadline } from "../server/gmail/contest-deadline";

describe("literal contest claim deadlines", () => {
  test("extracts named dates only beside a claim instruction", () => {
    expect(extractContestClaimDeadline("You won the recipient prize! Please reply by October 31,2026 to claim it.")).toBe("October 31,2026");
    expect(extractContestClaimDeadline("Congratulations. Claim your prize before October 31, 2026.")).toBe("October 31, 2026");
    expect(extractContestClaimDeadline("Accept your prize no later than November 2nd, 2026.")).toBe("November 2nd, 2026");
  });
  test("preserves ISO dates, weekdays and relative duration without date inference", () => {
    expect(extractContestClaimDeadline("Redeem by 2026-10-31.")).toBe("2026-10-31");
    expect(extractContestClaimDeadline("Respond before next Friday.")).toBe("next Friday");
    expect(extractContestClaimDeadline("Claim within48hours.")).toBe("within48hours");
    expect(extractContestClaimDeadline("Confirm your delivery address within 48 hours.")).toBe("within 48 hours");
    expect(extractContestClaimDeadline("Reply within two days.")).toBe("within two days");
  });
  test("does not infer entry deadlines or unsupported instructions", () => {
    for (const body of ["Enter by October 31,2026.", "Submit your entry by 2026-10-31.", "Confirm your entry by October 31,2026.", "You won! Claim your prize.",
      "Congratulations, contest deadline: October 31,2026.", "Reply soon.", "Claim by the end of the month.", "Reply by 31/10/2026."]) {
      expect(extractContestClaimDeadline(body)).toBeNull();
    }
  });
  test("skips simple negated claim instructions", () => {
    expect(extractContestClaimDeadline("Do not reply by October 31,2026.")).toBeNull();
    expect(extractContestClaimDeadline("You don't need to claim by Friday.")).toBeNull();
    expect(extractContestClaimDeadline("There is no need to reply within 48 hours.")).toBeNull();
  });
  test("conflicting deadlines return null while repeated literal deadlines agree", () => {
    expect(extractContestClaimDeadline("Reply by October 31,2026. Redeem before November 2,2026.")).toBeNull();
    expect(extractContestClaimDeadline("Reply by October 31,2026. Claim by October 31,2026.")).toBe("October 31,2026");
  });
  test("does not scan arbitrary long snippets between the action and deadline", () => {
    expect(extractContestClaimDeadline(`Claim ${"additional instructions ".repeat(20)} by October 31,2026.`)).toBeNull();
    const deadline = extractContestClaimDeadline(`Reply by October 31,2026 ${"details ".repeat(1000)}`);
    expect(deadline).toBe("October 31,2026");
    expect(deadline!.length).toBeLessThanOrEqual(120);
  });
});
