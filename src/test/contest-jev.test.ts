import { describe, expect, test } from "bun:test";
import { MAX_CONTEST_RESPONSE_TOKENS } from "../server/gmail/contest-usage";
import { createJevContestClassifier, JevClassificationError, CONTEST_PROMPT_VERSION, type JevFetcher } from "../server/gmail/contest-jev";

const MESSAGE = { labelIds: [], from: "Contest <prize@example.com>", replyTo: "", subject: "You won our contest", bodyText: "Reply to claim your prize." };
function validResponse() {
  return {
    model: "jev-1.13.0",
    answers: {
      category: { type: "choice", choice: "winner", probabilities: { winner: 0.8, new_contest: 0.05, entry_confirmation: 0.05, notification_update: 0.05, irrelevant: 0.05 }, confidence: 0.75 },
      explicit_win: { type: "noul", noul: 0.9 },
      claim_action: { type: "noul", noul: 0.85 },
    },
    usage: { input_tokens: 100, output_tokens: 30 },
  };
}
const jsonFetcher = (value: unknown): JevFetcher => (async () => Response.json(value)) as JevFetcher;
async function errorCode(classifier: ReturnType<typeof createJevContestClassifier>) {
  try { await classifier(MESSAGE); throw new Error("Expected failure"); }
  catch (error) {
    expect(error).toBeInstanceOf(JevClassificationError);
    const failure = error as JevClassificationError;
    expect(failure.message).not.toContain("secret-key");
    expect(failure.message).not.toContain("prize@example.com");
    return failure.code;
  }
}

describe("native Jev contest adapter", () => {
  test("missing key fails without network", async () => {
    let calls = 0;
    expect(await errorCode(createJevContestClassifier({ apiKey: "", fetcher: (async () => { calls += 1; return Response.json(validResponse()); }) as JevFetcher }))).toBe("configuration");
    expect(calls).toBe(0);
  });

  test("posts native questions, bounds email state, and parses metadata", async () => {
    let sent: RequestInit | undefined;
    let endpoint: string | URL | Request | undefined;
    const classifier = createJevContestClassifier({ apiKey: "secret-key", fetcher: (async (input, init) => {
      endpoint = input;
      sent = init;
      return Response.json(validResponse());
    }) as JevFetcher });
    const result = await classifier({ ...MESSAGE, from: "s".repeat(800), subject: "h".repeat(800), bodyText: "b".repeat(5000) });
    expect(endpoint).toBe("https://api.typesafe.ai/v1/systemone");
    expect(sent?.method).toBe("POST");
    expect(sent?.redirect).toBe("error");
    expect(sent?.headers).toEqual({ Authorization: "Bearer secret-key", "Content-Type": "application/json" });
    expect(sent?.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(sent?.body as string);
    expect(body.model).toBe("jev-latest");
    expect(body.state).toEqual({ sender: "s".repeat(500), subject: "h".repeat(500), body: "b".repeat(4000) });
    expect(Object.keys(body.questions)).toEqual(["category", "explicit_win", "claim_action"]);
    expect(body.questions.category.type).toBe("choice");
    expect(Object.keys(body.questions.category.criteria)).toEqual(["winner", "new_contest", "entry_confirmation", "notification_update", "irrelevant"]);
    expect(body.questions.explicit_win.type).toBe("noul");
    expect(body.questions.claim_action.type).toBe("noul");
    expect(body.questions.category.instructions).toContain("untrusted");
    expect(body.questions.category.instructions).toContain("thanks-for-entering");
    expect(result).toEqual({ category: "winner", categoryProbabilities: validResponse().answers.category.probabilities, confidence: 0.75, explicitWinProbability: 0.9, claimActionProbability: 0.85, model: "jev-1.13.0", promptVersion: CONTEST_PROMPT_VERSION, usage: { inputTokens: 100, outputTokens: 30 } });
  });

  test("passes a configured model", async () => {
    let model: string | undefined;
    await createJevContestClassifier({ apiKey: "key", model: "jev-specific", fetcher: (async (_, init) => { model = JSON.parse(init?.body as string).model; return Response.json(validResponse()); }) as JevFetcher })(MESSAGE);
    expect(model).toBe("jev-specific");
  });

  test.each([-0.01, 1.01, "0.8", null])("rejects invalid noul %s", async (score) => {
    const value = validResponse();
    const raw = { ...value, answers: { ...value.answers, explicit_win: { type: "noul", noul: score } } };
    expect(await errorCode(createJevContestClassifier({ apiKey: "secret-key", fetcher: jsonFetcher(raw) }))).toBe("invalid_response");
  });

  test("rejects missing answers, unknown options, invalid distribution, confidence and usage", async () => {
    const value = validResponse();
    const invalid = [
      { ...value, answers: { category: value.answers.category } },
      { ...value, answers: { ...value.answers, category: { ...value.answers.category, choice: "unknown" } } },
      { ...value, answers: { ...value.answers, category: { ...value.answers.category, probabilities: { ...value.answers.category.probabilities, winner: 0.1 } } } },
      { ...value, answers: { ...value.answers, category: { ...value.answers.category, confidence: 2 } } },
      { ...value, usage: { input_tokens: -1, output_tokens: 30 } },
    ];
    for (const raw of invalid) expect(await errorCode(createJevContestClassifier({ apiKey: "secret-key", fetcher: jsonFetcher(raw) }))).toBe("invalid_response");
  });

  test.each([[401, "authentication"], [403, "authentication"], [422, "provider"], [302, "provider"]] as const)("sanitizes HTTP %s", async (status, code) => {
    expect(await errorCode(createJevContestClassifier({ apiKey: "secret-key", fetcher: (async () => new Response("secret-key prize@example.com", { status })) as JevFetcher }))).toBe(code);
  });

  test("sanitizes exhausted rate limits", async () => {
    expect(await errorCode(createJevContestClassifier({ apiKey: "secret-key", fetcher: (async () => new Response("secret-key", { status: 429, headers: { "retry-after": "0" } })) as JevFetcher }))).toBe("rate_limit");
  });

  test("sanitizes transport and invalid JSON failures", async () => {
    expect(await errorCode(createJevContestClassifier({ apiKey: "secret-key", fetcher: (async () => { throw new Error("secret-key prize@example.com"); }) as JevFetcher }))).toBe("transport");
    expect(await errorCode(createJevContestClassifier({ apiKey: "secret-key", fetcher: (async () => new Response("secret-key prize@example.com")) as JevFetcher }))).toBe("invalid_response");
  });

  test("timeout covers stalled fetch and stalled response body", async () => {
    for (const fetcher of [
      (async () => new Promise<Response>(() => {})) as JevFetcher,
      (async () => new Response(new ReadableStream({ start() {} }))) as JevFetcher,
    ]) expect(await errorCode(createJevContestClassifier({ apiKey: "secret-key", timeoutMs: 10, fetcher }))).toBe("timeout");
  });
  test("accepts the bounded per-call token maximum and rejects one above it", async () => {
    const value = validResponse();
    const maximum = { ...value, usage: { input_tokens: MAX_CONTEST_RESPONSE_TOKENS, output_tokens: MAX_CONTEST_RESPONSE_TOKENS } };
    expect((await createJevContestClassifier({ apiKey: "key", fetcher: jsonFetcher(maximum) })(MESSAGE)).usage).toEqual({ inputTokens: MAX_CONTEST_RESPONSE_TOKENS, outputTokens: MAX_CONTEST_RESPONSE_TOKENS });
    expect(await errorCode(createJevContestClassifier({ apiKey: "secret-key", fetcher: jsonFetcher({ ...maximum, usage: { ...maximum.usage, output_tokens: MAX_CONTEST_RESPONSE_TOKENS + 1 } }) }))).toBe("invalid_response");
  });

});
