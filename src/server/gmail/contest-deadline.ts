const MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sep\\.?|Sept\\.?|Oct\\.?|Nov\\.?|Dec\\.?)";
const DATE = `(?:\\d{4}-\\d{2}-\\d{2}|${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?|(?:this\\s+|next\\s+)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))`;
const DURATION = "(?:[1-9]\\d{0,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\\s*(?:hours?|days?|weeks?)";
const INSTRUCTION = "\\b(?:claim|reply|respond|confirm|redeem|accept(?:\\s+(?:your|the))?\\s+prize)\\b";
const DEADLINE_PATTERN = new RegExp(`${INSTRUCTION}(?:\\s+[^.!?\\n]{0,60}?)?\\s+(?:(by|before|no later than)\\s+(${DATE})|(within)\\s*(${DURATION}))(?![\\w-])`, "gi");

/** Extracts supported literal claim deadlines. Always verify the original message in Gmail. */
export function extractContestClaimDeadline(body: string): string | null {
  const deadlines = new Map<string, string>();
  for (const match of body.matchAll(DEADLINE_PATTERN)) {
    const sentencePrefix = body.slice(Math.max(0, (match.index ?? 0) - 100), match.index).split(/[.!?\n]/).at(-1) ?? "";
    if (/\b(?:do not|don't|does not|doesn't|no need to|not required to|never)\s*(?:\w+\s+){0,3}$/i.test(sentencePrefix)) continue;
    if (/\b(?:not|never|entry|enter|submit)\b/i.test(match[0])) continue;
    const deadline = match[3] ? match[0].slice(match[0].toLowerCase().lastIndexOf("within")) : match[2];
    if (!deadline || deadline.length > 120) return null;
    const key = deadline.toLowerCase().replace(/\s+/g, " ").trim();
    deadlines.set(key, deadline);
    if (deadlines.size > 1) return null;
  }
  return deadlines.values().next().value ?? null;
}
