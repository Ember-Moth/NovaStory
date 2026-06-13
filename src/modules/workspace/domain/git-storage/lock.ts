const locks = new Map<string, Promise<unknown>>();

export async function withProjectLock<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => current);
  locks.set(projectId, chained);

  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (locks.get(projectId) === chained) {
      locks.delete(projectId);
    }
  }
}
