import {
  createBranch,
  deleteBranch,
  getBranch,
  listBranches,
  listBranchHeads,
} from "@/modules/workspace/domain";
import { rpcTags } from "@/rpc/tags";

export async function list(input: { projectId: string }): Promise<{
  data: ReturnType<typeof listBranches>;
  watch?: unknown[];
}> {
  const data = await listBranches(input.projectId);
  const watch = [rpcTags.branchesByProject(input.projectId)];
  return { data, watch };
}

export async function get(input: { projectId: string; branchId: string }): Promise<{
  data: ReturnType<typeof getBranch>;
  watch?: unknown[];
}> {
  const data = await getBranch(input.projectId, input.branchId);
  const watch = [rpcTags.branch(input.branchId)];
  return { data, watch };
}

export async function heads(input: { projectId: string }): Promise<{
  data: ReturnType<typeof listBranchHeads>;
  watch?: unknown[];
}> {
  const data = await listBranchHeads(input.projectId);
  const watch = [rpcTags.branchHeadsByProject(input.projectId)];
  return { data, watch };
}

export async function create(input: {
  projectId: string;
  name: string;
  fromCommitId?: string | null;
}): Promise<{
  data: Awaited<ReturnType<typeof createBranch>>;
  invalidate?: unknown[];
}> {
  const data = await createBranch(input);
  const invalidate = [
    rpcTags.branchesByProject(input.projectId),
    rpcTags.branchHeadsByProject(input.projectId),
    rpcTags.workspacesByProject(input.projectId),
    rpcTags.project(input.projectId),
    rpcTags.projectsList(),
  ];
  return { data, invalidate };
}

export async function deleteMutation(input: { projectId: string; branchId: string }): Promise<{
  data: void;
  invalidate?: unknown[];
}> {
  const data = await deleteBranch(input.projectId, input.branchId);
  const invalidate = [
    rpcTags.branchesByProject(input.projectId),
    rpcTags.branchHeadsByProject(input.projectId),
    rpcTags.branch(input.branchId),
    rpcTags.workspacesByProject(input.projectId),
    rpcTags.project(input.projectId),
    rpcTags.projectsList(),
  ];
  return { data, invalidate };
}
