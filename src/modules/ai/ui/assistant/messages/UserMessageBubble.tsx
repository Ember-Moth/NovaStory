import type { AssistantInputRefDisplay, AssistantMentionInput } from "@/modules/ai/domain/types";

function getAssistantMentionDisplayKey(mention: AssistantMentionInput | AssistantInputRefDisplay) {
  return "targetId" in mention ? mention.targetId : mention.refId;
}

function AssistantMentionDisplayChip({
  mention,
}: {
  mention: AssistantMentionInput | AssistantInputRefDisplay;
}) {
  return (
    <span className="inline-flex max-w-44 items-center gap-1 rounded-sm border border-sidebar-background/20 bg-sidebar-background/12 px-1.5 py-0.5 text-[12px] text-sidebar-background leading-4">
      <span className="icon-[material-symbols--prompt-suggestion] shrink-0 text-sm" />
      <span className="truncate">@{mention.label}</span>
    </span>
  );
}

export function UserMessageBubble({
  text,
  mentions,
}: {
  text: string;
  mentions: Array<AssistantMentionInput | AssistantInputRefDisplay>;
}) {
  return (
    <div className="flex max-w-[88%] flex-wrap items-center gap-1.5 rounded-lg bg-accent-foreground px-3 py-2 text-[13px] text-sidebar-background leading-5">
      {mentions.map((mention, index) => (
        <AssistantMentionDisplayChip
          key={`${mention.kind}:${getAssistantMentionDisplayKey(mention)}:${index}`}
          mention={mention}
        />
      ))}
      {text.length > 0 ? <span className="whitespace-pre-wrap">{text}</span> : null}
    </div>
  );
}
