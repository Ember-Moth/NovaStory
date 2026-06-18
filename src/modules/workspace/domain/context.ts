import { exportAuxSnapshotTree } from "./aux";
import { exportContentSubtree } from "./content";
import type { WritingContext } from "./types";

export function composeWritingContext(
  projectId: string,
  workspaceId: string,
  contentNodeId: string,
): WritingContext {
  const contentNode = exportContentSubtree(projectId, workspaceId, contentNodeId).nodes[0];
  if (!contentNode) {
    throw new Error("未找到章节。");
  }
  const timelinePointId = contentNode.anchorTimelinePointId;
  const auxTree = exportAuxSnapshotTree(projectId, workspaceId, timelinePointId);
  const flatten = (nodes: typeof auxTree.nodes): WritingContext["auxSnapshot"] =>
    nodes.flatMap((node) => [
      {
        nodeType: node.nodeType,
        name: node.name,
        content: node.content,
        symlinkTargetPath: node.symlinkTargetPath,
        timelinePointId: node.timelinePointId,
        path: node.path,
      },
      ...flatten(node.children),
    ]);

  return {
    contentNode,
    timelinePointId,
    auxSnapshot: flatten(auxTree.nodes).sort((left, right) => left.path.localeCompare(right.path)),
  };
}
