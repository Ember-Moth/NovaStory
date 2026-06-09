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
