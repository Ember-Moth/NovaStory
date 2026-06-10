export function insertProjectOptimistically<TProject extends { id: string }>(
  projects: readonly TProject[],
  project: TProject,
) {
  return [project, ...projects.filter((item) => item.id !== project.id)];
}

export function removeProjectOptimistically<TProject extends { id: string }>(
  projects: readonly TProject[],
  projectId: string,
) {
  return projects.filter((project) => project.id !== projectId);
}

export function updateProjectOptimistically<
  TProject extends { id: string; name: string; description: string | null; updatedAt: number },
>(
  projects: readonly TProject[],
  update: Pick<TProject, "id" | "name" | "description">,
  updatedAt = Date.now(),
) {
  return projects.map((project) =>
    project.id === update.id
      ? {
          ...project,
          name: update.name,
          description: update.description,
          updatedAt,
        }
      : project,
  );
}
