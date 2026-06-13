import type {
  AssistantInputRefDisplay,
  AssistantInputRefSnapshot,
  AssistantMentionInput,
} from "@/modules/ai/domain/types";
import { getGlobalPromptFromConfig } from "@/modules/ai/domain/user-config";
import { createId, invariant } from "@/shared/lib/domain";

export function resolveAssistantInputRefs(
  mentions: readonly AssistantMentionInput[] | null | undefined,
): AssistantInputRefSnapshot[] {
  if (mentions == null || mentions.length === 0) {
    return [];
  }

  return mentions.map((mention) => {
    invariant(mention.kind === "global-prompt", "当前只支持引用全局 Prompt。");
    invariant(mention.mode === "snapshot-ref", "全局 Prompt 只能以快照引用方式发送。");

    const targetId = mention.targetId.trim();
    invariant(targetId.length > 0, "Prompt 引用目标不能为空。");

    const prompt = getGlobalPromptFromConfig(targetId);
    invariant(prompt, "引用的 Prompt 不存在。");
    invariant(prompt.isEnabled, "引用的 Prompt 已被禁用。");

    return {
      refId: createId("assistant_ref"),
      kind: "global-prompt",
      mode: "snapshot-ref",
      label: prompt.name,
      source: {
        promptId: prompt.id,
      },
      snapshot: {
        id: prompt.id,
        name: prompt.name,
        description: prompt.description,
        content: prompt.content,
        updatedAt: prompt.updatedAt,
      },
    };
  });
}

export function buildAssistantRefDisplayParts(refs: readonly AssistantInputRefSnapshot[]) {
  return refs.map((ref) => ({
    partKind: "data-assistant-ref" as const,
    visibility: "public" as const,
    payload: {
      refId: ref.refId,
      kind: ref.kind,
      mode: ref.mode,
      label: ref.label,
    } satisfies AssistantInputRefDisplay,
  }));
}
