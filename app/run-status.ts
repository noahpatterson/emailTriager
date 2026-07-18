export type RunStatus = "running" | "bounded_incomplete" | "completed" | "partial_failure" | "failed";

export function formatRunTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString();
}

export function runMessage(status: RunStatus, trial = false): string {
  if (trial) {
    if (status === "bounded_incomplete") return "Trial batch complete. Use Trial more to classify the next 10 messages without applying labels.";
    if (status === "completed") return "Trial reached the end of the source label. No Gmail labels were changed.";
    if (status === "failed") return "This trial run stopped safely. No Gmail labels were changed.";
    if (status === "running") return "Trial classification in progress. Labels will not be applied.";
    return "Trial finished without applying labels.";
  }
  if (status === "bounded_incomplete") return "The safety limit was reached. Run sync again to continue from the saved checkpoint.";
  if (status === "partial_failure") return "Some messages could not be processed. Other messages were handled normally.";
  if (status === "failed") return "This run stopped safely. No unclassified message was moved.";
  if (status === "running") return "Messages are being classified locally and moved by label only.";
  return "The configured source label was exhausted for this run.";
}
