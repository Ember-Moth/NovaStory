import type { ProjectAssistantContextSnapshot } from "@/modules/ai/domain/types";

export interface ToolRuntimeContext {
  snapshot: ProjectAssistantContextSnapshot | null;
  updateSnapshot: (
    _updater: (
      _current: ProjectAssistantContextSnapshot | null,
    ) => ProjectAssistantContextSnapshot | null,
  ) => void;
}

export type ToolBuildContext = {
  projectId: string;
  runtimeContext: ToolRuntimeContext;
};
