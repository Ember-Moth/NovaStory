import type { ComponentProps, ReactNode } from "react";
import { BlockPolicy, harden } from "rehype-harden";
import { defaultRehypePlugins, Streamdown, type StreamdownProps } from "streamdown";

import { cn } from "@/shared/lib/cn";
import { MarkdownTable } from "@/shared/ui/markdown/MarkdownTable";
import { OverlayScrollbar } from "@/shared/ui/OverlayScrollbar";
import { SidebarMarkdownTable } from "./SidebarMarkdownTable";

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
  "ai-markdown overflow-hidden wrap-break-word text-foreground [&_[data-streamdown='table-wrapper']]:my-2";

const MARKDOWN_VARIANT_CLASS_NAMES = {
  assistant: "text-[13px] leading-5",
  reasoning: "text-[10px] leading-4",
} as const;

const BASE_MARKDOWN_COMPONENTS: NonNullable<StreamdownProps["components"]> = {
  code: MarkdownCode,
};

const MARKDOWN_ANIMATION: NonNullable<StreamdownProps["animated"]> = {
  animation: "slideUp",
};

export function AiMarkdown({
  content,
  isStreaming,
  variant,
  tableLayout = "default",
}: {
  content: string;
  isStreaming: boolean;
  variant: "assistant" | "reasoning";
  tableLayout?: "default" | "sidebar-cards";
}) {
  const components: NonNullable<StreamdownProps["components"]> = {
    ...BASE_MARKDOWN_COMPONENTS,
    table: tableLayout === "sidebar-cards" ? SidebarMarkdownTable : MarkdownTable,
  };

  return (
    <Streamdown
      mode={isStreaming ? "streaming" : "static"}
      parseIncompleteMarkdown={isStreaming}
      animated={MARKDOWN_ANIMATION}
      isAnimating={isStreaming}
      controls={false}
      rehypePlugins={AI_MARKDOWN_REHYPE_PLUGINS}
      components={components}
      className={cn(MARKDOWN_ROOT_CLASS_NAME, MARKDOWN_VARIANT_CLASS_NAMES[variant])}
    >
      {content}
    </Streamdown>
  );
}

function MarkdownCode({
  children,
  className,
  "data-block": dataBlock,
  node: _node,
  ...props
}: ComponentProps<"code"> & {
  "data-block"?: boolean | "true";
  children?: ReactNode;
  node?: unknown;
}) {
  const code = getCodeText(children);
  if (dataBlock) {
    const language = getCodeLanguage(className);
    const lines = code.split("\n");

    return (
      <div className="my-2" data-streamdown="code-block">
        <div
          className="flex h-6 items-center text-[10px] text-foreground-muted"
          data-streamdown="code-block-header"
        >
          <span className="font-mono lowercase">{language}</span>
        </div>
        <OverlayScrollbar
          variant="inline"
          className="ai-code-scrollbar"
          data-streamdown="code-block-body"
        >
          <pre className="font-mono text-[12px] text-foreground leading-5">
            <code>
              {lines.map((line, index) => (
                <span
                  key={`line:${index + 1}`}
                  className="grid grid-cols-[2.5rem_minmax(0,max-content)] gap-4"
                >
                  <span className="select-none text-right text-foreground-muted/55">
                    {index + 1}
                  </span>
                  <span className="whitespace-pre">{line.length > 0 ? line : "\u00a0"}</span>
                </span>
              ))}
            </code>
          </pre>
        </OverlayScrollbar>
      </div>
    );
  }

  return (
    <code {...props} className={className} data-streamdown="inline-code">
      {children}
    </code>
  );
}

function getCodeText(children: ReactNode) {
  if (typeof children === "string") {
    return children;
  }

  if (Array.isArray(children)) {
    return children.flatMap((child) => (typeof child === "string" ? [child] : [])).join("");
  }

  return "";
}

function getCodeLanguage(className: string | undefined) {
  const matched = className?.match(/language-([A-Za-z0-9_+-]+)/);
  return matched?.[1]?.toLowerCase() ?? "text";
}
