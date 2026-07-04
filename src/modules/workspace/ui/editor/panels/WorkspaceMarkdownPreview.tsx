import type { ComponentProps, ReactNode } from "react";
import { BlockPolicy, harden } from "rehype-harden";
import { defaultRehypePlugins, Streamdown, type StreamdownProps } from "streamdown";

import { cn } from "@/shared/lib/cn";
import { MarkdownTable } from "@/shared/ui/markdown/MarkdownTable";
import { OverlayScrollbar } from "@/shared/ui/OverlayScrollbar";

const WORKSPACE_MARKDOWN_REHYPE_PLUGINS: NonNullable<StreamdownProps["rehypePlugins"]> = [
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

const WORKSPACE_MARKDOWN_COMPONENTS: NonNullable<StreamdownProps["components"]> = {
  code: WorkspaceMarkdownCode,
  table: MarkdownTable,
};

export function WorkspaceMarkdownPreview({
  content,
  emptyLabel,
}: {
  content: string;
  emptyLabel: string;
}) {
  const trimmedContent = content.trim();

  return (
    <OverlayScrollbar variant="panel" className="bg-editor-background">
      <div className="min-h-full px-6 py-5">
        {trimmedContent.length > 0 ? (
          <Streamdown
            mode="static"
            parseIncompleteMarkdown={false}
            animated={false}
            controls={false}
            rehypePlugins={WORKSPACE_MARKDOWN_REHYPE_PLUGINS}
            components={WORKSPACE_MARKDOWN_COMPONENTS}
            className="ai-markdown wrap-break-word max-w-4xl text-[14px] text-foreground leading-7"
          >
            {content}
          </Streamdown>
        ) : (
          <div className="flex min-h-48 items-center justify-center text-foreground-muted text-sm">
            {emptyLabel}
          </div>
        )}
      </div>
    </OverlayScrollbar>
  );
}

function WorkspaceMarkdownCode({
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
  if (dataBlock) {
    return (
      <code
        {...props}
        className={cn(
          "block overflow-x-auto whitespace-pre rounded-none font-mono text-[13px] text-foreground leading-6",
          className,
        )}
      >
        {children}
      </code>
    );
  }

  return (
    <code {...props} className={className} data-streamdown="inline-code">
      {children}
    </code>
  );
}
