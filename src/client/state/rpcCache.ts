export function moveArrayItem<TItem>(items: readonly TItem[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length) {
    return [...items];
  }

  const nextItems = [...items];
  const [item] = nextItems.splice(fromIndex, 1);
  if (item === undefined) {
    return [...items];
  }

  nextItems.splice(Math.min(toIndex, nextItems.length), 0, item);
  return nextItems;
}

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
