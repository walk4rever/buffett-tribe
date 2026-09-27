/**
 * Backward-compatibility wrapper for pipeline-priority-worker.ts
 *
 * `scripts/pipeline-phase1-worker.ts` has been upgraded to `scripts/pipeline-priority-worker.ts`
 * to support the unified priority queue (Phase 0 -> Phase 1 and Phase 1 -> Phase 2).
 */
import "./pipeline-priority-worker";
