import type {
  AgentThreadNodeView,
  AssistantInputRefDisplay,
  ProjectAssistantContextSnapshot,
} from "@/modules/ai/domain/types";

export interface AssistantReasoningEntry {
  partId: string;
  text: string;
}

export interface AssistantContentBlock {
  kind: "text" | "reasoning";
  blockId: string;
  text: string;
}

export function getMessageText(node: AgentThreadNodeView | null | undefined) {
  const content = (node?.message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object") {
        return [];
      }
      return Reflect.get(part as Record<string, unknown>, "type") === "text"
        ? [Reflect.get(part as Record<string, unknown>, "text")]
        : [];
    })
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

export function getAssistantRefDisplays(
  node: AgentThreadNodeView | null | undefined,
): AssistantInputRefDisplay[] {
  if (!node || node.role !== "user") {
    return [];
  }

  return node.parts.flatMap((part) => {
    if (part.partKind !== "data-assistant-ref") {
      return [];
    }
    const payload = part.payload;
    if (!payload || typeof payload !== "object") {
      return [];
    }
    const refId = Reflect.get(payload, "refId");
    const kind = Reflect.get(payload, "kind");
    const mode = Reflect.get(payload, "mode");
    const label = Reflect.get(payload, "label");
    if (
      typeof refId !== "string" ||
      kind !== "global-prompt" ||
      mode !== "snapshot-ref" ||
      typeof label !== "string"
    ) {
      return [];
    }
    return [{ refId, kind, mode, label }];
  });
}

export function getAssistantContentBlocks(node: AgentThreadNodeView | null | undefined) {
  if (!node || node.role !== "assistant") {
    return [] as AssistantContentBlock[];
  }

  const blocks: AssistantContentBlock[] = [];

  node.parts.forEach((part) => {
    if (part.partKind !== "text" && part.partKind !== "reasoning") {
      return;
    }

    const payload = part.payload;
    if (!payload || typeof payload !== "object") {
      return;
    }

    const text = Reflect.get(payload as Record<string, unknown>, "text");
    if (typeof text !== "string" || text.length === 0) {
      return;
    }

    const kind = part.partKind;
    const previousBlock = blocks.at(-1);
    if (previousBlock?.kind === kind) {
      previousBlock.text = `${previousBlock.text}\n${text}`;
      return;
    }

    blocks.push({
      kind,
      blockId: part.id,
      text,
    });
  });

  return blocks;
}

export function getAssistantReasoning(node: AgentThreadNodeView | null | undefined) {
  if (!node || node.role !== "assistant") {
    return [] as AssistantReasoningEntry[];
  }

  return node.parts
    .filter((part) => part.partKind === "reasoning")
    .flatMap((part) => {
      const payload = part.payload;
      if (!payload || typeof payload !== "object") {
        return [];
      }
      const text = Reflect.get(payload as Record<string, unknown>, "text");
      if (typeof text !== "string" || text.trim().length === 0) {
        return [];
      }
      return [{ partId: part.id, text } satisfies AssistantReasoningEntry];
    });
}

export function listAssistantContextDetails(context: ProjectAssistantContextSnapshot) {
  return [
    {
      label: "正文",
      value: context.activeContentTitle ?? "未选中",
    },
    {
      label: "辅助",
      value: context.activeAuxPath ?? "未选中",
    },
    {
      label: "时间",
      value: context.activeTimelineLabel ?? "未选中",
    },
  ];
}
