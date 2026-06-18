import { getDefaultWorkspace } from "@/modules/workspace/domain";

import type {
  AssistantToolEnvelope,
  AssistantToolErrorContext,
  AssistantToolSuccess,
} from "./envelope";
import { failure } from "./envelope";

type ProjectWorkspace = NonNullable<Awaited<ReturnType<typeof getDefaultWorkspace>>>;

export async function getWorkspaceForProject(projectId: string) {
  return await getDefaultWorkspace(projectId);
}

export async function withProjectWorkspace<T>(input: {
  projectId: string;
  execute: (workspace: ProjectWorkspace) => Promise<AssistantToolSuccess<T>>;
  getContext?: () => AssistantToolErrorContext;
}): Promise<AssistantToolEnvelope<T>> {
  try {
    const workspace = await getWorkspaceForProject(input.projectId);
    if (!workspace) {
      throw new Error("当前项目没有默认工作区。");
    }
    return await input.execute(workspace);
  } catch (error) {
    return failure(error, input.getContext);
  }
}
