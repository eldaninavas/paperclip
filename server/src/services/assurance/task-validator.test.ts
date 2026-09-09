import { describe, expect, it } from "vitest";
import { shouldRequestAssuranceTaskApproval } from "./task-validator.js";

describe("Assurance task approval timing", () => {
  it.each(["backlog", "todo", "in_progress", "in_review", "blocked"])(
    "does not request human approval while a task is %s",
    (status) => {
      expect(shouldRequestAssuranceTaskApproval({
        status,
        humanAcceptanceRequired: true,
      })).toBe(false);
    },
  );

  it("requests approval for a completed task when its review policy requires a human", () => {
    expect(shouldRequestAssuranceTaskApproval({
      status: "done",
      humanAcceptanceRequired: true,
    })).toBe(true);
  });

  it("does not request approval when a completed task has no human-review requirement", () => {
    expect(shouldRequestAssuranceTaskApproval({
      status: "done",
      humanAcceptanceRequired: false,
    })).toBe(false);
  });
});
