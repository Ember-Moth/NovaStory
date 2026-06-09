import {
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "@/shared/lib/cn";

const INPUT_CLASS_NAME =
  "box-border h-5.5 min-w-0 flex-1 rounded border border-border bg-editor-background px-1.5 text-[13px] leading-5.5 text-foreground outline-none select-text focus:border-accent-foreground";

const DISPLAY_CLASS_NAME = "block min-h-5.5 min-w-0 flex-1 w-full leading-5.5";

export function useInlineEdit({
  value,
  onCommit,
  editable = true,
  disabled = false,
  allowEmpty = false,
  onEditStart,
  onEditingChange,
}: {
  value: string;
  onCommit: (_next: string) => Promise<boolean>;
  editable?: boolean;
  disabled?: boolean;
  allowEmpty?: boolean;
  onEditStart?: () => void;
  onEditingChange?: (_editing: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditing]);

  const setEditing = (editing: boolean) => {
    setIsEditing(editing);
    onEditingChange?.(editing);
  };

  const cancelEditing = () => {
    setDraft(value);
    setEditing(false);
  };

  const startEditing = () => {
    if (!editable || disabled) {
      return;
    }

    onEditStart?.();
    setDraft(value);
    setEditing(true);
  };

  const commitEditing = async () => {
    if (!isEditing) {
      return;
    }

    const normalized = draft.trim();
    if (!allowEmpty && !normalized) {
      cancelEditing();
      return;
    }

    if (normalized === value.trim()) {
      cancelEditing();
      return;
    }

    const committed = await onCommit(normalized);
    if (committed) {
      setEditing(false);
      onEditingChange?.(false);
    }
  };

  const inputProps = {
    value: draft,
    disabled,
    onChange: (event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
    onBlur: () => void commitEditing(),
    onClick: (event: MouseEvent<HTMLInputElement>) => event.stopPropagation(),
    onDoubleClick: (event: MouseEvent<HTMLInputElement>) => event.stopPropagation(),
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void commitEditing();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelEditing();
      }
    },
  };

  return {
    isEditing,
    draft,
    setDraft,
    startEditing,
    cancelEditing,
    commitEditing,
    inputRef,
    inputProps,
  };
}

export function InlineEditInput({
  inputRef,
  inputProps,
  placeholder,
  className,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  inputProps: {
    value: string;
    disabled?: boolean;
    onChange: (_event: ChangeEvent<HTMLInputElement>) => void;
    onBlur: () => void;
    onClick: (_event: MouseEvent<HTMLInputElement>) => void;
    onDoubleClick: (_event: MouseEvent<HTMLInputElement>) => void;
    onKeyDown: (_event: KeyboardEvent<HTMLInputElement>) => void;
  };
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      ref={inputRef}
      {...inputProps}
      className={className ?? INPUT_CLASS_NAME}
      placeholder={placeholder}
    />
  );
}

export function InlineEditableText({
  value,
  onCommit,
  editable = true,
  disabled = false,
  allowEmpty = false,
  placeholder,
  className,
  onEditStart,
  onEditingChange,
}: {
  value: string;
  onCommit: (_next: string) => Promise<boolean>;
  editable?: boolean;
  disabled?: boolean;
  allowEmpty?: boolean;
  placeholder?: string;
  className?: string;
  onEditStart?: () => void;
  onEditingChange?: (_editing: boolean) => void;
}) {
  const { isEditing, startEditing, inputRef, inputProps } = useInlineEdit({
    value,
    onCommit,
    editable,
    disabled,
    allowEmpty,
    onEditStart,
    onEditingChange,
  });

  if (isEditing) {
    return (
      <InlineEditInput
        inputRef={inputRef}
        inputProps={inputProps}
        placeholder={placeholder}
        className={cn(INPUT_CLASS_NAME, className)}
      />
    );
  }

  return (
    <span
      className={cn(DISPLAY_CLASS_NAME, className)}
      onDoubleClick={(event) => {
        if (!editable || disabled) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        startEditing();
      }}
    >
      {value}
    </span>
  );
}
