import {
  PROJECT_ASSISTANT_READ_ONLY_TOOL_NAMES,
  PROJECT_ASSISTANT_WRITE_TOOL_NAMES,
  type ProjectAssistantToolName,
} from "@/modules/ai/domain/types";

export function buildProjectAssistantSendActiveTools({
  allowWrites,
}: {
  allowWrites: boolean;
}): ProjectAssistantToolName[] {
  return allowWrites
    ? [...PROJECT_ASSISTANT_READ_ONLY_TOOL_NAMES, ...PROJECT_ASSISTANT_WRITE_TOOL_NAMES]
    : [...PROJECT_ASSISTANT_READ_ONLY_TOOL_NAMES];
}

export function buildProjectAssistantRetryActiveTools(): ProjectAssistantToolName[] {
  return [...PROJECT_ASSISTANT_READ_ONLY_TOOL_NAMES];
}
