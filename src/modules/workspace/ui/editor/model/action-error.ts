export type ActionError = {
  message: string;
  anchorId: string;
} | null;

export type ActionErrorScope = "content" | "aux" | "timeline" | "sidebar";

export function actionAnchorId(scope: ActionErrorScope, action: string, id?: string) {
  return id ? `${scope}:${action}:${id}` : `${scope}:${action}`;
}

export function clearActionError(setter: (_value: ActionError) => void) {
  setter(null);
}

export function setActionError(
  setter: (_value: ActionError) => void,
  message: string,
  anchorId: string,
) {
  setter({ message, anchorId });
}
