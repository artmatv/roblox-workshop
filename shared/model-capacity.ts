// Capacity is a temporary provider failure, not a rejected game deliverable.
export function isModelCapacityError(
  message: string | null | undefined,
): boolean {
  return (
    !!message &&
    !message.startsWith("Результат не принят:") &&
    /(?:selected model is at capacity|model.{0,60}(?:overloaded|at capacity))/i.test(
      message,
    )
  );
}
