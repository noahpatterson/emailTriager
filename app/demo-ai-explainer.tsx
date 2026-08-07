import { DEMO_AI_DISABLED_MESSAGE } from "@/src/server/demo/ai-gate";

/** Shared explainer for AI surfaces that are disabled in the public demo. */
export function DemoAiExplainer({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="card" aria-label={title}>
      <p className="step">DEMO · EXPLAINER</p>
      <h2>{title}</h2>
      <p>{DEMO_AI_DISABLED_MESSAGE}</p>
      {children}
    </section>
  );
}
