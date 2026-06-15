import {
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isTextNode,
  DecoratorNode,
  type EditorState,
  type ElementNode,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import type { ReactNode } from "react";

import type {
  AssistantMentionInput,
  AssistantMentionKind,
  AssistantMentionMode,
} from "@/modules/ai/domain/types";
export type {
  AssistantMentionInput,
  AssistantMentionKind,
  AssistantMentionMode,
} from "@/modules/ai/domain/types";

export type AssistantComposerSubmitPayload = {
  text: string;
  mentions: AssistantMentionInput[];
};

export type SerializedAssistantMentionNode = Spread<AssistantMentionInput, SerializedLexicalNode>;

export class AssistantMentionNode extends DecoratorNode<ReactNode> {
  __kind: AssistantMentionKind;
  __mode: AssistantMentionMode;
  __targetId: string;
  __label: string;

  static override getType(): string {
    return "assistant-mention";
  }

  static override clone(node: AssistantMentionNode): AssistantMentionNode {
    return new AssistantMentionNode(
      node.__kind,
      node.__mode,
      node.__targetId,
      node.__label,
      node.__key,
    );
  }

  static override importJSON(serializedNode: SerializedAssistantMentionNode): AssistantMentionNode {
    return $createAssistantMentionNode({
      kind: serializedNode.kind,
      mode: serializedNode.mode,
      targetId: serializedNode.targetId,
      label: serializedNode.label,
    }).updateFromJSON(serializedNode);
  }

  constructor(
    kind: AssistantMentionKind,
    mode: AssistantMentionMode,
    targetId: string,
    label: string,
    key?: NodeKey,
  ) {
    super(key);
    this.__kind = kind;
    this.__mode = mode;
    this.__targetId = targetId;
    this.__label = label;
  }

  override afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__kind = prevNode.__kind;
    this.__mode = prevNode.__mode;
    this.__targetId = prevNode.__targetId;
    this.__label = prevNode.__label;
  }

  override exportJSON(): SerializedAssistantMentionNode {
    return {
      ...super.exportJSON(),
      kind: this.__kind,
      mode: this.__mode,
      targetId: this.__targetId,
      label: this.__label,
    };
  }

  override updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedAssistantMentionNode>): this {
    return super.updateFromJSON(serializedNode).setMention({
      kind: serializedNode.kind,
      mode: serializedNode.mode,
      targetId: serializedNode.targetId,
      label: serializedNode.label,
    });
  }

  override createDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "inline-flex align-middle leading-none";
    return element;
  }

  override updateDOM(): false {
    return false;
  }

  override decorate(): ReactNode {
    return (
      <span
        className="inline-flex h-5 max-w-44 items-center gap-1 rounded-sm border border-accent-foreground/45 bg-accent-background/35 px-1.5 text-[12px] leading-none text-accent-foreground"
        data-assistant-mention-kind={this.__kind}
        data-assistant-mention-target-id={this.__targetId}
      >
        <span className="icon-[material-symbols--prompt-suggestion] shrink-0 text-sm leading-none" />
        <span className="truncate leading-none">@{this.__label}</span>
      </span>
    );
  }

  override getTextContent(): string {
    return "";
  }

  override isInline(): true {
    return true;
  }

  override isKeyboardSelectable(): true {
    return true;
  }

  setMention(mention: AssistantMentionInput): this {
    const self = this.getWritable();
    self.__kind = mention.kind;
    self.__mode = mention.mode;
    self.__targetId = mention.targetId;
    self.__label = mention.label;
    return self;
  }

  getMention(): AssistantMentionInput {
    const latest = this.getLatest();
    return {
      kind: latest.__kind,
      mode: latest.__mode,
      targetId: latest.__targetId,
      label: latest.__label,
    };
  }
}

export function $createAssistantMentionNode(mention: AssistantMentionInput): AssistantMentionNode {
  return new AssistantMentionNode(mention.kind, mention.mode, mention.targetId, mention.label);
}

export function $isAssistantMentionNode(
  node: LexicalNode | null | undefined,
): node is AssistantMentionNode {
  return node instanceof AssistantMentionNode;
}

export function compileAssistantComposerState(
  editorState: EditorState,
): AssistantComposerSubmitPayload {
  let text = "";
  const mentions: AssistantMentionInput[] = [];
  editorState.read(() => {
    text = compileRootNode($getRoot(), mentions);
  });

  return {
    text,
    mentions,
  };
}

function compileRootNode(root: ElementNode, mentions: AssistantMentionInput[]) {
  return root
    .getChildren()
    .map((child) => compileNode(child, mentions))
    .join("\n");
}

function compileNode(node: LexicalNode, mentions: AssistantMentionInput[]): string {
  if ($isAssistantMentionNode(node)) {
    mentions.push(node.getMention());
    return "";
  }

  if ($isTextNode(node)) {
    return node.getTextContent();
  }

  if ($isLineBreakNode(node)) {
    return "\n";
  }

  if ($isElementNode(node)) {
    return node
      .getChildren()
      .map((child) => compileNode(child, mentions))
      .join("");
  }

  return "";
}
