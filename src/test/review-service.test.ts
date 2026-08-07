import { describe, expect, test } from "bun:test";
import {
  parseOwnerLabel,
  ReviewClientError,
} from "../server/gmail/review-queue";

describe("parseOwnerLabel", () => {
  test("accepts the four categories", () => {
    expect(parseOwnerLabel("priority")).toBe("priority");
    expect(parseOwnerLabel("review")).toBe("review");
    expect(parseOwnerLabel("new")).toBe("new");
    expect(parseOwnerLabel("archive")).toBe("archive");
  });

  test("rejects invalid labels", () => {
    expect(() => parseOwnerLabel("protected")).toThrow(ReviewClientError);
    expect(() => parseOwnerLabel(null)).toThrow(ReviewClientError);
  });
});
