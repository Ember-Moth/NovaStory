type ModelCapabilitiesShape = {
  family?: string | null;
  contextWindow?: number | null;
  supportsToolUse?: boolean | null;
  supportsReasoning?: boolean | null;
  supportsVision?: boolean | null;
};

export function formatModelCapabilities(model: ModelCapabilitiesShape) {
  const values = [
    model.family,
    model.contextWindow ? `${model.contextWindow.toLocaleString("zh-CN")} tokens` : null,
    model.supportsToolUse ? "工具" : null,
    model.supportsReasoning ? "推理" : null,
    model.supportsVision ? "视觉" : null,
  ].filter(Boolean);

  return values.length > 0 ? values.join(" · ") : null;
}
