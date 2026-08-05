# Category Intent is the standard of correctness, not the term lists

Asking whether a message was filed correctly is meaningless while the term lists define correctness, because then every filing is correct by construction and a judge that disagrees is only a fuzzy, non-deterministic reimplementation of the same rules. So the owner writes **Category Intent** — prose stating what each category means — and that becomes the standard. Term lists are demoted to a cheap, fast approximation of intent, and a small **Exemplar Pool** of owner-labeled messages supplements the prose as concrete examples.

## Consequences

Two overlapping configuration artifacts now exist for the same categories. This is deliberate: intent is the specification, terms are the fast path, and the gap between them is the thing worth measuring.

Every feature downstream falls out of this framing. The judge measures the gap between terms and intent on a single message. Human review checks whether the judge read intent correctly. Evaluating the matching algorithm means quantifying how well a term list approximates intent across the golden set, which makes "suggest better terms" a well-posed problem rather than a vibe.

A **Holdout** partition exists solely because of the exemplar pool: any message shown to a judge as an example is worthless for scoring that judge. The two partitions must be disjoint by construction and the split must be recorded, or evaluation results are not reproducible.
