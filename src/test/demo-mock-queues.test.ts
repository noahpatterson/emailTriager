import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { ADVERSARIAL_CORPUS } = await import("@/src/server/gmail/corpus");
const {
  DEMO_MOCK_DEMOTION_COUNT,
  DEMO_MOCK_MODEL_NAME,
  DEMO_MOCK_MODEL_PROVIDER,
  DEMO_MOCK_QUEUE_SEEDS,
  DEMO_MOCK_REVIEW_COUNT,
} = await import("@/src/server/demo/seed-mock-queues");

describe("demo mock review/demotion fixtures", () => {
  test("seeds five review disagreements and one demotion from known corpus ids", () => {
    expect(DEMO_MOCK_REVIEW_COUNT).toBe(5);
    expect(DEMO_MOCK_DEMOTION_COUNT).toBe(1);
    expect(DEMO_MOCK_QUEUE_SEEDS).toHaveLength(6);
    expect(DEMO_MOCK_QUEUE_SEEDS.filter((seed) => seed.forDemotion)).toHaveLength(1);
    expect(DEMO_MOCK_QUEUE_SEEDS.filter((seed) => !seed.forDemotion)).toHaveLength(5);

    for (const seed of DEMO_MOCK_QUEUE_SEEDS) {
      expect(ADVERSARIAL_CORPUS.some((row) => row.id === seed.fixtureId)).toBe(true);
    }
  });

  test("tags seeded audits with the demo mock model identity", () => {
    expect(DEMO_MOCK_MODEL_PROVIDER).toBe("mock");
    expect(DEMO_MOCK_MODEL_NAME).toBe("demo-fixture-judge");
  });
});
