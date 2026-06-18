import { createProjectMeta } from "@/modules/workspace/domain/git-storage/project-meta-store";

export async function seedProjectRecord(
  projectId: string,
  overrides: { name?: string; description?: string | null } = {},
) {
  const timestamp = Date.now();
  await createProjectMeta({
    id: projectId,
    name: overrides.name ?? `Project ${projectId}`,
    description: overrides.description ?? null,
    defaultBranchId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
