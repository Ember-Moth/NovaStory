import { BlockPolicy, harden } from "rehype-harden";
import { Streamdown, defaultRehypePlugins, type StreamdownProps } from "streamdown";

import { cn } from "@/shared/lib/cn";

const AI_MARKDOWN_REHYPE_PLUGINS: NonNullable<StreamdownProps["rehypePlugins"]> = [
  defaultRehypePlugins.sanitize!,
  [
    harden,
    {
      allowedProtocols: ["http", "https", "mailto"],
      allowedLinkPrefixes: ["*"],
      allowedImagePrefixes: [],
      allowDataImages: false,
      linkBlockPolicy: BlockPolicy.textOnly,
      imageBlockPolicy: BlockPolicy.remove,
    },
  ],
];

const MARKDOWN_ROOT_CLASS_NAME =
  "ai-markdown overflow-hidden break-words text-foreground [&_[data-streamdown='table-wrapper']]:my-2";

const MARKDOWN_VARIANT_CLASS_NAMES = {
  assistant: "text-[13px] leading-5",
  reasoning: "text-[10px] leading-4",
} as const;

export function AiMarkdown({
  content,
  isStreaming,
  variant,
}: {
  content: string;
  isStreaming: boolean;
  variant: "assistant" | "reasoning";
}) {
  return (
    <Streamdown
      mode={isStreaming ? "streaming" : "static"}
      parseIncompleteMarkdown={isStreaming}
      isAnimating={false}
      controls={false}
      rehypePlugins={AI_MARKDOWN_REHYPE_PLUGINS}
      className={cn(MARKDOWN_ROOT_CLASS_NAME, MARKDOWN_VARIANT_CLASS_NAMES[variant])}
    >
      {content}
    </Streamdown>
  );
}
