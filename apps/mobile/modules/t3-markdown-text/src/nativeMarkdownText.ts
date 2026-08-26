import type { MarkdownNode } from "react-native-nitro-markdown/headless";

import type { SelectableMarkdownSkill } from "./SelectableMarkdownText.types";
import { resolveMarkdownLinkPresentation, type MarkdownFileIcon } from "./markdownLinks";

export type MarkdownWritingDirection = "ltr" | "rtl";

export interface NativeMarkdownTextRun {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly strikethrough?: boolean;
  readonly code?: boolean;
  readonly href?: string;
  readonly externalHost?: string;
  readonly fileIcon?: MarkdownFileIcon;
  readonly skillName?: string;
  readonly skillLabel?: string;
  readonly role?:
    | "body"
    | "heading"
    | "list-marker"
    | "list-break"
    | "quote-marker"
    | "code-block"
    | "code-language"
    | "divider"
    | "spacer";
  readonly headingLevel?: number;
  readonly depth?: number;
  readonly spacing?: number;
  readonly firstLineHeadIndent?: number;
  readonly headIndent?: number;
  readonly paragraphSpacing?: number;
  readonly writingDirection?: MarkdownWritingDirection;
}

export type NativeMarkdownDocumentChunk =
  | {
      readonly kind: "selectable";
      readonly key: string;
      readonly node: MarkdownNode;
    }
  | {
      readonly kind: "rich";
      readonly key: string;
      readonly node: MarkdownNode;
    };

interface RunContext {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly strikethrough: boolean;
  readonly code: boolean;
  readonly href?: string;
  readonly externalHost?: string;
  readonly fileIcon?: MarkdownFileIcon;
  readonly role?: NativeMarkdownTextRun["role"];
  readonly headingLevel?: number;
  readonly depth?: number;
  readonly spacing?: number;
  readonly firstLineHeadIndent?: number;
  readonly headIndent?: number;
  readonly paragraphSpacing?: number;
  readonly writingDirection?: MarkdownWritingDirection;
}

const EMPTY_CONTEXT: RunContext = {
  bold: false,
  italic: false,
  strikethrough: false,
  code: false,
};

const INLINE_HTML_TAG_PATTERN = /<\/?(?:kbd|mark|sub|sup|u)(?:\s[^>]*)?>/gi;

// Strong-RTL code points: Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan, Mandaic and
// their extensions/presentation forms, plus the astral RTL blocks (Phoenician … Adlam).
const STRONG_RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
// First letter decides (UBA P2/P3): digits, punctuation and symbols are neutral.
const FIRST_LETTER = /\p{L}/u;

// The direction a block of text renders in — what the web app's `dir="auto"` would resolve.
export function firstStrongDirection(text: string): MarkdownWritingDirection {
  const letter = FIRST_LETTER.exec(text)?.[0];
  return letter && STRONG_RTL_CHAR.test(letter) ? "rtl" : "ltr";
}

// The Latin spans that must not get the direction vote: tech tokens a Hebrew
// sentence often *opens* with (a URL, an inline-code span, a path, a file name
// — "server.py זה הקובץ הראשי"), plus quoted or parenthesized Latin — a cited
// title or gloss ('הוספתי סעיף "Build-feedback call additions"', "אסטרטגיות
// (product-lens)") names a thing rather than continuing the prose. Mirrors the
// web app's pattern (each app keeps its own copy — no cross-app imports) and
// stripLeadingLTR from the claude-desktop-rtl-patch.
const LTR_TECH_TOKEN =
  /https?:\/\/\S+|`[^`\n]+`|\S*[/\\]\S+|\b\w+\.\w{1,5}\b|"[^"\n]+"|[“«][^”»\n]+[”»]|\([^()\n]+\)/gu;

function stripLtrTechTokens(text: string): string {
  // A span carrying its own strong-RTL letters (an RTL slash pair like כן/לא,
  // a Hebrew quotation) is prose, not a citation — it keeps its vote.
  return text.replace(LTR_TECH_TOKEN, (token) => (STRONG_RTL_CHAR.test(token) ? token : " "));
}

// The last-resort vote: which strong script owns most of the text's letters.
// Counted per letter (`\p{L}`), so neutral digits/punctuation and RTL combining
// marks (niqqud, harakat — marks, not letters) never tilt the tally.
function rtlLetterMajority(text: string): boolean {
  let balance = 0;
  for (const letter of text.match(/\p{L}/gu) ?? []) {
    balance += STRONG_RTL_CHAR.test(letter) ? 1 : -1;
  }
  return balance > 0;
}

// First-strong, with two corrections for RTL prose that *opens* with Latin:
// a leading tech token (URL, path, file name) never gets the first-strong vote,
// and a text whose letters are mostly RTL is RTL even when it leads with a
// Latin prose label — "**Next step (ישן):** מתחילים לבנות…" is a Hebrew
// sentence, and reading it LTR strands its closing punctuation on the wrong
// side. A mostly-English text with a few Hebrew words stays LTR — its Latin
// letters keep the majority.
export function resolvedTextDirection(text: string): MarkdownWritingDirection {
  if (firstStrongDirection(text) === "rtl") {
    return "rtl";
  }
  if (!STRONG_RTL_CHAR.test(text)) {
    return "ltr";
  }
  const stripped = stripLtrTechTokens(text);
  if (firstStrongDirection(stripped) === "rtl") {
    return "rtl";
  }
  return rtlLetterMajority(stripped) ? "rtl" : "ltr";
}

// Code and tables opt out of direction detection and stay LTR: their shape is not
// prose, so their letters must not decide the direction of the block around them —
// the same nodes the web app pins with an explicit `dir="ltr"` (which `dir="auto"`
// then skips when resolving an ancestor).
const DIRECTION_NEUTRAL_NODE_TYPES = new Set(["code_block", "code_inline", "table"]);

function directionSourceText(node: MarkdownNode): string {
  if (DIRECTION_NEUTRAL_NODE_TYPES.has(node.type)) {
    return "";
  }
  if (node.type === "html_inline" || node.type === "html_block") {
    // Tag names are letters too — only the text an HTML node renders may vote.
    return inlineHtmlText(nodeTextContent(node));
  }
  if (node.content !== undefined) {
    return node.content;
  }
  return (node.children ?? []).map(directionSourceText).join("");
}

// The base direction of a markdown block, resolved from the block's own first
// strong letter (mirroring the web renderer's per-block `dir="auto"`) — with
// leading Latin tech tokens discounted. Code spans are already excluded
// structurally by directionSourceText; URLs, paths and file names living in
// plain text are handled by the strip fallback.
export function markdownBlockDirection(node: MarkdownNode): MarkdownWritingDirection {
  return resolvedTextDirection(directionSourceText(node));
}

function decodeCodePoint(codePoint: number, entity: string): string {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return entity;
  }
  return String.fromCodePoint(codePoint);
}

function decodeHtmlEntitiesOnce(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|amp|apos|gt|lt|nbsp|quot);/gi,
    (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
      if (decimal) {
        return decodeCodePoint(Number.parseInt(decimal, 10), entity);
      }
      if (hexadecimal) {
        return decodeCodePoint(Number.parseInt(hexadecimal, 16), entity);
      }
      switch (entity.toLowerCase()) {
        case "&amp;":
          return "&";
        case "&apos;":
          return "'";
        case "&gt;":
          return ">";
        case "&lt;":
          return "<";
        case "&nbsp;":
          return "\u00a0";
        case "&quot;":
          return '"';
        default:
          return entity;
      }
    },
  );
}

function decodeHtmlEntities(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = decodeHtmlEntitiesOnce(decoded);
    if (next === decoded) {
      break;
    }
    decoded = next;
  }
  return decoded;
}

function textNodeContent(value: string): string {
  return decodeHtmlEntities(value).replace(INLINE_HTML_TAG_PATTERN, "");
}

function inlineHtmlText(value: string): string {
  if (/^<br\s*\/?>$/i.test(value.trim())) {
    return "\n";
  }
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ""));
}

function sameRunStyle(left: NativeMarkdownTextRun, right: NativeMarkdownTextRun): boolean {
  return (
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.strikethrough === right.strikethrough &&
    left.code === right.code &&
    left.href === right.href &&
    left.externalHost === right.externalHost &&
    left.fileIcon === right.fileIcon &&
    left.skillName === right.skillName &&
    left.skillLabel === right.skillLabel &&
    left.role === right.role &&
    left.headingLevel === right.headingLevel &&
    left.depth === right.depth &&
    left.spacing === right.spacing &&
    left.firstLineHeadIndent === right.firstLineHeadIndent &&
    left.headIndent === right.headIndent &&
    left.paragraphSpacing === right.paragraphSpacing &&
    left.writingDirection === right.writingDirection
  );
}

function appendRun(
  runs: NativeMarkdownTextRun[],
  text: string,
  context: RunContext,
): NativeMarkdownTextRun[] {
  if (text.length === 0) {
    return runs;
  }

  const run: NativeMarkdownTextRun = {
    text,
    ...(context.bold ? { bold: true } : {}),
    ...(context.italic ? { italic: true } : {}),
    ...(context.strikethrough ? { strikethrough: true } : {}),
    ...(context.code ? { code: true } : {}),
    ...(context.href ? { href: context.href } : {}),
    ...(context.externalHost ? { externalHost: context.externalHost } : {}),
    ...(context.fileIcon ? { fileIcon: context.fileIcon } : {}),
    ...(context.role ? { role: context.role } : {}),
    ...(context.headingLevel ? { headingLevel: context.headingLevel } : {}),
    ...(context.depth ? { depth: context.depth } : {}),
    ...(context.spacing ? { spacing: context.spacing } : {}),
    ...(context.firstLineHeadIndent !== undefined
      ? { firstLineHeadIndent: context.firstLineHeadIndent }
      : {}),
    ...(context.headIndent !== undefined ? { headIndent: context.headIndent } : {}),
    ...(context.paragraphSpacing !== undefined
      ? { paragraphSpacing: context.paragraphSpacing }
      : {}),
    ...(context.writingDirection ? { writingDirection: context.writingDirection } : {}),
  };
  const previous = runs.at(-1);
  if (previous && sameRunStyle(previous, run)) {
    runs[runs.length - 1] = { ...previous, text: previous.text + run.text };
    return runs;
  }

  runs.push(run);
  return runs;
}

const SKILL_TOKEN_REGEX = /(^|\s)\$([a-zA-Z][a-zA-Z0-9:_-]*)(?=\s|$)/g;

function formatSkillLabel(skill: SelectableMarkdownSkill): string {
  const displayName = skill.displayName?.trim();
  if (displayName) {
    return displayName;
  }
  return skill.name
    .split(/[\s:_-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function decorateSkillRuns(
  runs: ReadonlyArray<NativeMarkdownTextRun>,
  skills: ReadonlyArray<SelectableMarkdownSkill>,
): ReadonlyArray<NativeMarkdownTextRun> {
  if (skills.length === 0) {
    return runs;
  }
  const skillByName = new Map(skills.map((skill) => [skill.name, skill]));
  const decorated: NativeMarkdownTextRun[] = [];

  for (const run of runs) {
    if (run.code || run.href || run.fileIcon || run.role === "code-block") {
      decorated.push(run);
      continue;
    }

    let cursor = 0;
    let matched = false;
    for (const match of run.text.matchAll(SKILL_TOKEN_REGEX)) {
      const prefix = match[1] ?? "";
      const name = match[2] ?? "";
      const skill = skillByName.get(name);
      if (!skill) {
        continue;
      }
      const start = (match.index ?? 0) + prefix.length;
      const end = start + name.length + 1;
      if (start > cursor) {
        decorated.push({ ...run, text: run.text.slice(cursor, start) });
      }
      decorated.push({
        ...run,
        text: run.text.slice(start, end),
        skillName: name,
        skillLabel: formatSkillLabel(skill),
      });
      cursor = end;
      matched = true;
    }
    if (!matched) {
      decorated.push(run);
    } else if (cursor < run.text.length) {
      decorated.push({ ...run, text: run.text.slice(cursor) });
    }
  }

  return decorated;
}

function appendChildren(
  runs: NativeMarkdownTextRun[],
  node: MarkdownNode,
  context: RunContext,
): NativeMarkdownTextRun[] {
  for (const child of node.children ?? []) {
    appendNode(runs, child, context);
  }
  return runs;
}

function nodeTextContent(node: MarkdownNode): string {
  if (node.content !== undefined) {
    return node.content;
  }
  return (node.children ?? []).map(nodeTextContent).join("");
}

// Inside a right-to-left paragraph the bidi algorithm hands the neutrals around
// a Latin run — quotes, commas, a plus sign — to whichever strong run is
// nearer, which strands them on the wrong visual side ('"AIOS" סותר' flips its
// quotes, "U1+U2+U3, ההסלמה" splits the comma off its run). Isolating each run
// (LRI … PDI, the same isolate inline code uses) lets that punctuation resolve
// against the Hebrew it belongs to. A run may span several words joined by
// thin neutrals ("speed-to-lead", "U1+U2+U3+U5", "OpenAI export"); a connector
// is only swallowed when another Latin word follows it, so sentence-final
// punctuation stays outside the isolate. Mirrors the web app's <bdi> pass.
const LATIN_RUN = /\p{Script=Latin}[\p{Script=Latin}\d]*(?:[ +&/.:'@_-]+[\p{Script=Latin}\d]+)*/gu;

function isolateLatinRuns(text: string): string {
  return text.replace(LATIN_RUN, (run) => `\u2066${run}\u2069`);
}

function appendNode(
  runs: NativeMarkdownTextRun[],
  node: MarkdownNode,
  context: RunContext,
): NativeMarkdownTextRun[] {
  switch (node.type) {
    case "text": {
      const content = textNodeContent(nodeTextContent(node));
      return appendRun(
        runs,
        context.writingDirection === "rtl" ? isolateLatinRuns(content) : content,
        context,
      );
    }
    case "math_inline":
      return appendRun(runs, textNodeContent(nodeTextContent(node)), context);
    case "html_inline":
      return appendRun(runs, inlineHtmlText(nodeTextContent(node)), context);
    case "code_inline": {
      // Inline code keeps its left-to-right shape even inside an RTL paragraph
      // (the web pins `code` to LTR with CSS). Attributed strings have no
      // per-span direction, so wrap the span in an LTR isolate (LRI … PDI).
      const content = nodeTextContent(node);
      return appendRun(
        runs,
        context.writingDirection === "rtl" ? `\u2066${content}\u2069` : content,
        { ...context, code: true },
      );
    }
    case "soft_break":
      return appendRun(runs, " ", context);
    case "line_break":
      return appendRun(runs, "\n", context);
    case "bold":
      return appendChildren(runs, node, { ...context, bold: true });
    case "italic":
      return appendChildren(runs, node, { ...context, italic: true });
    case "strikethrough":
      return appendChildren(runs, node, { ...context, strikethrough: true });
    case "link": {
      const presentation = resolveMarkdownLinkPresentation(node.href ?? "");
      if (presentation.kind === "file") {
        return appendRun(runs, presentation.label, {
          ...context,
          href: presentation.href,
          fileIcon: presentation.icon,
        });
      }
      if (presentation.kind === "external") {
        return appendChildren(runs, node, {
          ...context,
          href: presentation.href,
          externalHost: presentation.host,
        });
      }
      return appendChildren(runs, node, {
        ...context,
        ...(presentation.href ? { href: presentation.href } : {}),
      });
    }
    case "image":
      return appendRun(runs, node.alt ?? node.title ?? "", context);
    default:
      return appendChildren(runs, node, context);
  }
}

export function nativeMarkdownTextRuns(node: MarkdownNode): ReadonlyArray<NativeMarkdownTextRun> {
  return appendChildren([], node, EMPTY_CONTEXT);
}

export function nativeMarkdownWithPreservedSoftBreaks(node: MarkdownNode): MarkdownNode {
  const children = node.children?.map(nativeMarkdownWithPreservedSoftBreaks);
  return {
    ...node,
    ...(node.type === "soft_break" ? { type: "line_break" as const } : {}),
    ...(children ? { children } : {}),
  };
}

function appendBlockTerminator(
  runs: NativeMarkdownTextRun[],
  context: RunContext,
): NativeMarkdownTextRun[] {
  return appendRun(runs, "\n", context);
}

function appendSpacer(runs: NativeMarkdownTextRun[], spacing: number): NativeMarkdownTextRun[] {
  return appendRun(runs, "\n", { ...EMPTY_CONTEXT, role: "spacer", spacing });
}

function appendInlineChildren(
  runs: NativeMarkdownTextRun[],
  node: MarkdownNode,
  context: RunContext,
): NativeMarkdownTextRun[] {
  for (const child of node.children ?? []) {
    appendNode(runs, child, context);
  }
  return runs;
}

function isInlineNode(node: MarkdownNode): boolean {
  return (
    node.type === "text" ||
    node.type === "bold" ||
    node.type === "italic" ||
    node.type === "strikethrough" ||
    node.type === "link" ||
    node.type === "image" ||
    node.type === "code_inline" ||
    node.type === "math_inline" ||
    node.type === "html_inline" ||
    node.type === "soft_break" ||
    node.type === "line_break"
  );
}

export function nativeMarkdownListItemBlocks(node: MarkdownNode): ReadonlyArray<MarkdownNode> {
  const blocks: MarkdownNode[] = [];
  let inlineNodes: MarkdownNode[] = [];
  const flushInlineNodes = () => {
    if (inlineNodes.length === 0) {
      return;
    }
    blocks.push({ type: "paragraph", children: inlineNodes });
    inlineNodes = [];
  };

  for (const child of node.children ?? []) {
    if (isInlineNode(child)) {
      inlineNodes.push(child);
      continue;
    }

    flushInlineNodes();
    blocks.push(child);
  }
  flushInlineNodes();
  return blocks;
}

function appendListItem(
  runs: NativeMarkdownTextRun[],
  node: MarkdownNode,
  marker: string,
  depth: number,
  markerColumnWidth: number,
  writingDirection: MarkdownWritingDirection,
): NativeMarkdownTextRun[] {
  const firstLineHeadIndent = Math.max(0, depth - 1) * 20;
  appendRun(runs, `${marker}\t`, {
    ...EMPTY_CONTEXT,
    role: "list-marker",
    depth,
    firstLineHeadIndent,
    headIndent: firstLineHeadIndent + markerColumnWidth,
    paragraphSpacing: 2,
    writingDirection,
  });

  const children = node.children ?? [];
  let wroteInlineContent = false;
  for (const child of children) {
    if (child.type === "paragraph") {
      appendInlineChildren(runs, child, {
        ...EMPTY_CONTEXT,
        role: "body",
        depth,
        writingDirection,
      });
      wroteInlineContent = true;
      continue;
    }
    if (child.type === "list") {
      if (wroteInlineContent) {
        appendBlockTerminator(runs, {
          ...EMPTY_CONTEXT,
          role: "list-break",
          depth,
          spacing: 1,
          writingDirection,
        });
      }
      appendList(runs, child, depth + 1, writingDirection);
      wroteInlineContent = false;
      continue;
    }
    if (isInlineNode(child)) {
      appendNode(runs, child, {
        ...EMPTY_CONTEXT,
        role: "body",
        depth,
        writingDirection,
      });
      wroteInlineContent = true;
      continue;
    }
    appendDocumentBlock(runs, child, depth, writingDirection);
    wroteInlineContent = true;
  }

  if (wroteInlineContent) {
    appendBlockTerminator(runs, {
      ...EMPTY_CONTEXT,
      role: "list-break",
      depth,
      spacing: depth === 1 ? 4 : 2,
      writingDirection,
    });
  }
  return runs;
}

function appendList(
  runs: NativeMarkdownTextRun[],
  node: MarkdownNode,
  depth: number,
  // Each item resolves its own direction (a Hebrew item in an English list
  // still gets its marker on the right, mirroring the web's per-item `dir`),
  // unless the list sits inside an already-claimed block — then it inherits.
  inheritedDirection?: MarkdownWritingDirection,
): NativeMarkdownTextRun[] {
  const ordered = node.ordered ?? false;
  const start = node.start ?? 1;
  const children = node.children ?? [];
  const markers = children.map((child, index) =>
    child.type === "task_list_item"
      ? child.checked
        ? "☑︎"
        : "☐︎"
      : ordered
        ? `${start + index}.`
        : depth % 3 === 2
          ? "◦"
          : depth % 3 === 0
            ? "▪︎"
            : "•",
  );
  const markerWidth = ordered
    ? Math.max(0, ...markers.map((marker) => Array.from(marker).length))
    : 0;

  for (const [index, child] of children.entries()) {
    const marker = markers[index] ?? "•";
    const alignedMarker =
      child.type === "task_list_item"
        ? marker
        : ordered
          ? `${"\u2007".repeat(Math.max(0, markerWidth - Array.from(marker).length))}${marker}`
          : marker;
    const markerColumnWidth =
      child.type === "task_list_item" ? 28 : ordered ? 10 + markerWidth * 8 : 24;
    appendListItem(
      runs,
      child,
      alignedMarker,
      depth,
      markerColumnWidth,
      inheritedDirection ?? markdownBlockDirection(child),
    );
  }
  return runs;
}

function appendQuoteBlock(
  runs: NativeMarkdownTextRun[],
  node: MarkdownNode,
  depth: number,
  writingDirection: MarkdownWritingDirection,
): NativeMarkdownTextRun[] {
  for (const [index, child] of (node.children ?? []).entries()) {
    if (index > 0) {
      appendBlockTerminator(runs, { ...EMPTY_CONTEXT, role: "body", depth, writingDirection });
    }
    appendRun(runs, "│\u00a0", {
      ...EMPTY_CONTEXT,
      role: "quote-marker",
      depth,
      writingDirection,
    });
    if (child.type === "paragraph") {
      appendInlineChildren(runs, child, {
        ...EMPTY_CONTEXT,
        role: "body",
        depth,
        writingDirection,
      });
    } else {
      appendDocumentBlock(runs, child, depth, writingDirection);
    }
  }
  appendBlockTerminator(runs, { ...EMPTY_CONTEXT, role: "body", depth, writingDirection });
  return runs;
}

function appendTableRow(
  runs: NativeMarkdownTextRun[],
  node: MarkdownNode,
  depth: number,
): NativeMarkdownTextRun[] {
  const cells = node.children ?? [];
  for (const [index, cell] of cells.entries()) {
    if (index > 0) {
      appendRun(runs, "\u00a0│\u00a0", {
        ...EMPTY_CONTEXT,
        role: "divider",
        depth,
        writingDirection: "ltr",
      });
    }
    appendInlineChildren(runs, cell, {
      ...EMPTY_CONTEXT,
      role: "body",
      bold: cell.isHeader ?? false,
      depth,
      writingDirection: "ltr",
    });
  }
  appendBlockTerminator(runs, { ...EMPTY_CONTEXT, role: "body", depth, writingDirection: "ltr" });
  return runs;
}

function appendTable(
  runs: NativeMarkdownTextRun[],
  node: MarkdownNode,
  depth: number,
): NativeMarkdownTextRun[] {
  const visit = (child: MarkdownNode) => {
    if (child.type === "table_row") {
      appendTableRow(runs, child, depth);
      return;
    }
    for (const nested of child.children ?? []) {
      visit(nested);
    }
  };
  visit(node);
  return runs;
}

function appendDocumentBlock(
  runs: NativeMarkdownTextRun[],
  node: MarkdownNode,
  depth = 0,
  // Only the outermost block of a run resolves its own direction; nested blocks
  // inherit it, so a list or quote reads as one directional unit (the web marks
  // only the outermost block with `dir="auto"` for the same reason).
  direction?: MarkdownWritingDirection,
): NativeMarkdownTextRun[] {
  switch (node.type) {
    case "document": {
      const children = node.children ?? [];
      for (const [index, child] of children.entries()) {
        if (index > 0) {
          const previous = children[index - 1];
          appendSpacer(
            runs,
            child.type === "heading" ? 20 : previous?.type === "heading" ? 10 : 12,
          );
        }
        appendDocumentBlock(runs, child, depth, direction);
      }
      return runs;
    }
    case "heading": {
      const context: RunContext = {
        ...EMPTY_CONTEXT,
        role: "heading",
        headingLevel: node.level ?? 1,
        depth,
        writingDirection: direction ?? markdownBlockDirection(node),
      };
      appendInlineChildren(runs, node, context);
      return appendBlockTerminator(runs, context);
    }
    case "paragraph": {
      const context: RunContext = {
        ...EMPTY_CONTEXT,
        role: "body",
        depth,
        writingDirection: direction ?? markdownBlockDirection(node),
      };
      appendInlineChildren(runs, node, context);
      return appendBlockTerminator(runs, context);
    }
    case "list":
      return appendList(runs, node, depth + 1, direction);
    case "blockquote":
      return appendQuoteBlock(runs, node, depth, direction ?? markdownBlockDirection(node));
    case "code_block": {
      // Code stays LTR always: identifiers and paths read the same in every
      // locale, and a Hebrew comment must not flip the snippet.
      if (node.language) {
        appendRun(runs, `${node.language.toUpperCase()}\n`, {
          ...EMPTY_CONTEXT,
          role: "code-language",
          code: true,
          depth,
          writingDirection: "ltr",
        });
      }
      const content = nodeTextContent(node);
      appendRun(runs, content, {
        ...EMPTY_CONTEXT,
        role: "code-block",
        code: true,
        depth,
        writingDirection: "ltr",
      });
      if (!content.endsWith("\n")) {
        appendBlockTerminator(runs, {
          ...EMPTY_CONTEXT,
          role: "code-block",
          code: true,
          depth,
          writingDirection: "ltr",
        });
      }
      return runs;
    }
    case "horizontal_rule":
      appendRun(runs, "────────────────────────\n", {
        ...EMPTY_CONTEXT,
        role: "divider",
        depth,
      });
      return runs;
    case "table":
      return appendTable(runs, node, depth);
    case "html_block": {
      const context: RunContext = {
        ...EMPTY_CONTEXT,
        role: "body",
        depth,
        writingDirection: direction ?? markdownBlockDirection(node),
      };
      appendRun(runs, inlineHtmlText(nodeTextContent(node)), context);
      return appendBlockTerminator(runs, context);
    }
    case "math_block": {
      const context: RunContext = {
        ...EMPTY_CONTEXT,
        role: "body",
        depth,
        writingDirection: direction ?? markdownBlockDirection(node),
      };
      appendRun(runs, nodeTextContent(node), context);
      return appendBlockTerminator(runs, context);
    }
    default: {
      const context: RunContext = {
        ...EMPTY_CONTEXT,
        role: "body",
        depth,
        writingDirection: direction ?? markdownBlockDirection(node),
      };
      appendInlineChildren(runs, node, context);
      return appendBlockTerminator(runs, context);
    }
  }
}

function containsRichBlock(node: MarkdownNode): boolean {
  if (
    node.type === "code_block" ||
    node.type === "blockquote" ||
    node.type === "table" ||
    node.type === "image" ||
    node.type === "horizontal_rule" ||
    node.type === "html_block" ||
    node.type === "math_block"
  ) {
    return true;
  }
  return (node.children ?? []).some(containsRichBlock);
}

export function nativeMarkdownDocumentChunks(
  document: MarkdownNode,
): ReadonlyArray<NativeMarkdownDocumentChunk> {
  const chunks: NativeMarkdownDocumentChunk[] = [];
  let selectableNodes: MarkdownNode[] = [];

  const flushSelectable = () => {
    if (selectableNodes.length === 0) {
      return;
    }
    const first = selectableNodes[0];
    const last = selectableNodes.at(-1);
    chunks.push({
      kind: "selectable",
      key: `selectable:${first?.beg ?? "start"}:${last?.end ?? "end"}`,
      node: {
        type: "document",
        children: selectableNodes,
      },
    });
    selectableNodes = [];
  };

  for (const [index, child] of (document.children ?? []).entries()) {
    if (!containsRichBlock(child)) {
      selectableNodes.push(child);
      continue;
    }

    flushSelectable();
    chunks.push({
      kind: "rich",
      key: `rich:${child.type}:${child.beg ?? index}:${child.end ?? index}`,
      node: child,
    });
  }
  flushSelectable();
  return chunks;
}

function topLevelNodes(node: MarkdownNode): ReadonlyArray<MarkdownNode> {
  return node.type === "document" ? (node.children ?? []) : [node];
}

export function nativeMarkdownChunkSpacing(
  previous: NativeMarkdownDocumentChunk | undefined,
  current: NativeMarkdownDocumentChunk,
): number {
  if (!previous) {
    return 0;
  }

  const previousLast = topLevelNodes(previous.node).at(-1);
  const currentFirst = topLevelNodes(current.node)[0];

  if (currentFirst?.type === "heading") {
    return 20;
  }
  if (previousLast?.type === "heading") {
    return 10;
  }
  if (previousLast?.type === "list" && currentFirst?.type === "list") {
    return 12;
  }
  return 14;
}

export function nativeMarkdownDocumentRuns(
  node: MarkdownNode,
  skills: ReadonlyArray<SelectableMarkdownSkill> = [],
  direction?: MarkdownWritingDirection,
): ReadonlyArray<NativeMarkdownTextRun> {
  const runs = appendDocumentBlock([], node, 0, direction);
  while (runs.length > 0) {
    const lastIndex = runs.length - 1;
    const last = runs[lastIndex];
    if (!last?.text.endsWith("\n")) {
      break;
    }
    const text = last.text.slice(0, -1);
    if (text.length === 0) {
      runs.pop();
    } else {
      runs[lastIndex] = { ...last, text };
    }
  }
  return decorateSkillRuns(runs, skills);
}
