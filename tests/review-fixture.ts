import { Engine } from "../server/engine.js";
import { id, hash } from "../server/store.js";
import type { Task, Manifest } from "../shared/domain.js";
import type { ResultReview } from "../server/orchestrator.js";

// Existing integration fixtures start after the independent review boundary.
export function acceptReviewed(engine: Engine, task: Task, result: Manifest) {
  const prepared = engine.prepareResult(task, result);
  const review: ResultReview = {
    id: id(),
    taskId: task.id,
    projectId: task.projectId,
    attempt: task.attempt,
    candidateHash: hash(prepared),
    requirementsHash: engine.taskRequirementsHash(
      engine.project(task.projectId),
      task,
    ),
    status: "accepted",
    createdAt: new Date().toISOString(),
    reviewedAt: new Date().toISOString(),
    appliedAt: null,
    threadId: "fixture-review-thread",
    turnId: "fixture-review-turn",
    summary: "Reviewed fixture",
    issues: [],
  };
  engine.store.put("resultReview", review);
  task.reviewId = review.id;
  engine.store.put("task", task);
  return engine.acceptResult(task, result);
}
