export function mergeProjectActionGroups<
  TEditor extends object,
  TContent extends object,
  TTimeline extends object,
  TAux extends object,
  TMisc extends object,
>({
  editor,
  content,
  timeline,
  aux,
  misc,
}: {
  editor: TEditor;
  content: TContent;
  timeline: TTimeline;
  aux: TAux;
  misc: TMisc;
}): TEditor & TContent & TTimeline & TAux & TMisc {
  return {
    ...editor,
    ...content,
    ...timeline,
    ...aux,
    ...misc,
  };
}
