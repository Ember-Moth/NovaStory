import type { ProjectAssistantToolName } from "@/modules/ai/domain/types";

export const CONTENT_READ_TOOL_NAMES = ["list_manuscript_nodes", "read_manuscript_node"] as const;
export const CONTENT_WRITE_TOOL_NAMES = [
  "create_manuscript_node",
  "update_manuscript_node",
  "move_manuscript_node",
  "delete_manuscript_node",
] as const;
export const TIMELINE_TOOL_NAMES = [
  "list_story_timeline_points",
  "list_current_timeline_aux_changes",
  "set_current_timeline",
  "create_story_timeline_points",
  "update_story_timeline_point",
  "move_story_timeline_point",
  "delete_story_timeline_point",
] as const;
export const AUX_READ_TOOL_NAMES = ["list_files", "read_file"] as const;
export const AUX_WRITE_TOOL_NAMES = [
  "create_dir",
  "write_file",
  "move_path",
  "delete_path",
  "create_symlink",
  "retarget_symlink",
] as const;

export type ContentReadToolName = (typeof CONTENT_READ_TOOL_NAMES)[number];
export type ContentWriteToolName = (typeof CONTENT_WRITE_TOOL_NAMES)[number];
export type TimelineToolName = (typeof TIMELINE_TOOL_NAMES)[number];
export type AuxReadToolName = (typeof AUX_READ_TOOL_NAMES)[number];
export type AuxWriteToolName = (typeof AUX_WRITE_TOOL_NAMES)[number];

type AllAssistantToolNames =
  | ContentReadToolName
  | ContentWriteToolName
  | TimelineToolName
  | AuxReadToolName
  | AuxWriteToolName;

type MissingFromPartition = Exclude<ProjectAssistantToolName, AllAssistantToolNames>;
type ExtraneousInPartition = Exclude<AllAssistantToolNames, ProjectAssistantToolName>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const toolNamePartitionCheck: MissingFromPartition | ExtraneousInPartition = undefined!;
