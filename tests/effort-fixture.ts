export const effortModels = [
  {
    id: "test-model",
    model: "test-model",
    isDefault: true,
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map(
      (reasoningEffort) => ({ reasoningEffort }),
    ),
  },
  ...["gpt-6.1-sol", "gpt-6-luna", "gpt-6-astra"].map((model) => ({
    id: model,
    model,
    isDefault: false,
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map(
      (reasoningEffort) => ({ reasoningEffort }),
    ),
  })),
];
