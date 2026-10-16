import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import "../index.css";

import { filesystemEnvironment } from "../state/filesystem";

const { workspaceSearch, filesystemMetadata } = vi.hoisted(() => ({
  workspaceSearch: vi.fn(),
  filesystemMetadata: vi.fn(),
}));
vi.mock(import("../state/use-atom-query-runner"), async (original) => ({
  ...(await original()),
  useAtomQueryRunner: ((family: unknown) =>
    family === filesystemEnvironment.getMetadata ? filesystemMetadata : workspaceSearch) as never,
}));

// Atoms derived from the server config run in the real registry over a missing config.
vi.mock(import("../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const noConfig = Atom.make(null);
  return {
    ...actual,
    serverEnvironment: { ...actual.serverEnvironment, configValueAtom: (() => noConfig) as never },
  };
});
// A standard client session, so environment-owned file links can open.
vi.mock(import("../state/session"), async (original) => {
  const { AuthStandardClientScopes } = await import("@t3tools/contracts");
  const granted = new Set<string>(AuthStandardClientScopes);
  const hasScope = (environmentId: unknown, scope: string) =>
    environmentId !== null && granted.has(scope);
  return {
    ...(await original()),
    useEnvironmentScope: hasScope as never,
    readEnvironmentScope: hasScope as never,
  };
});
vi.mock(import("../remoteOpen"), async (original) => ({
  ...(await original()),
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }) as never,
}));
const { renderDiagram } = vi.hoisted(() => ({
  renderDiagram: vi.fn<(source: string) => Promise<string> | undefined>(),
}));
// Control rendering latency without running Mermaid layout.
vi.mock(import("./chat/MermaidDiagram"), async (original) => {
  const { use } = await import("react");
  return {
    ...(await original()),
    MermaidDiagram: ({ source }: { source: string }) => {
      const pending = renderDiagram(source);
      return <svg role="img" aria-label={pending ? use(pending) : "Diagram"} />;
    },
  };
});

const settingsOverrides = vi.hoisted(() => ({ mathRenderingEnabled: false }));
vi.mock(import("../hooks/useSettings"), async (original) => {
  const actual = await original();
  type Settings = ReturnType<typeof actual.getClientSettings>;
  function useClientSettings<T = Settings>(select?: (settings: Settings) => T): T {
    const settings = { ...actual.getClientSettings(), ...settingsOverrides };
    return select ? select(settings) : (settings as T);
  }
  return { ...actual, useClientSettings };
});

import ChatMarkdown, { firstStrongDirection, resolvedTextDirection } from "./ChatMarkdown";

// Rendered markup of one message, read from the live DOM after the tree settles.
async function renderHtml(text: string, props: Partial<Parameters<typeof ChatMarkdown>[0]> = {}) {
  settingsOverrides.mathRenderingEnabled = false;
  renderDiagram.mockReset();
  workspaceSearch.mockReset().mockResolvedValue(AsyncResult.success({ entries: [] }));
  filesystemMetadata.mockReset().mockResolvedValue(AsyncResult.success({ entries: [null] }));
  await using screen = await render(
    <ChatMarkdown cwd="/repo" text={text} parseRawHtml {...props} />,
  );
  return screen.container.innerHTML;
}

describe("chat markdown text direction", () => {
  it("lets each block pick its own direction from its own text", async () => {
    const html = await renderHtml("English first.\n\nمرحبا بالعالم.");
    expect(html).toContain('<p dir="auto">English first.</p>');
    expect(html).toContain('<p dir="auto">مرحبا بالعالم.</p>');
  });

  it("marks headings, lists, and quotes so their markers follow the text", async () => {
    const html = await renderHtml("# عنوان\n\n- عنصر\n\n> اقتباس");
    expect(html).toContain('<h1 dir="auto" id=');
    // The list's gutter side is pinned from all its items together.
    expect(html).toContain('<ul dir="rtl">');
    expect(html).toContain('<blockquote dir="auto">');
  });

  it("gives every list item its own direction, so mixed lists keep each marker beside its text", async () => {
    const html = await renderHtml("- English item\n- פריט בעברית");
    expect(html).toContain('<ul dir="ltr">');
    expect(html).toContain('<li dir="auto">');
  });

  it("gives a nested list's items their own direction too, not just the top level", async () => {
    // A Hebrew item nested under an English top-level item must still get its
    // own `dir`, or its marker inherits the (wrong) English sub-list side.
    const html = await renderHtml("- English top\n  - English sub\n  - פריט בעברית");
    expect(html).toContain('<li dir="auto">פריט בעברית</li>');
  });

  it("gives raw HTML blocks their own direction too", async () => {
    // Raw HTML arrives via `rehypeRaw`, after the mdast direction pass has
    // already run, so without the rehype pass these keep the inherited LTR
    // alignment however `unicode-bidi: plaintext` reorders the glyphs.
    const html = await renderHtml("<p>שלום עולם</p>");
    expect(html).toContain('<p dir="auto">שלום עולם</p>');
  });

  it("gives each raw table cell its own direction, not the table's", async () => {
    const html = await renderHtml(
      "<table><tbody><tr><td>English cell</td><td>خلية عربية</td></tr></tbody></table>",
    );
    expect(html).toContain('<td dir="auto">English cell</td>');
    expect(html).toContain('<td dir="auto">خلية عربية</td>');
  });

  it("keeps a direction the raw HTML author wrote", async () => {
    const html = await renderHtml('<p dir="ltr">שלום</p>');
    expect(html).toContain('<p dir="ltr">שלום</p>');
    expect(html).not.toContain('<p dir="auto">שלום</p>');
  });

  it("does not re-mark the blocks inside a claimed raw container", async () => {
    const html = await renderHtml('<blockquote dir="rtl"><p>שלום</p></blockquote>');
    expect(html).not.toContain('<p dir="auto">');
  });

  it("isolates Latin runs in RTL prose even when raw HTML is not parsed", async () => {
    // `rehypeIsolateLatinRuns` is not tied to raw HTML; it must still run when
    // a caller opts out of `rehypeRaw`.
    const html = await renderHtml('הפקודה "git status" עובדת.', { parseRawHtml: false });
    expect(html).toContain("<bdi>git status</bdi>");
  });

  it("does not re-mark the blocks inside a claimed quote", async () => {
    const html = await renderHtml("> اقتباس");
    // The DOM serializes adjacent tags with no separator, so
    // this is the actual boundary a nested, wrongly re-marked paragraph
    // would produce — the newline-separated form the assertion used to check
    // for can never appear in real output.
    expect(html).not.toContain('<blockquote dir="auto"><p dir="auto">');
  });

  it("pins code left-to-right so an Arabic comment cannot reorder a snippet", async () => {
    const html = await renderHtml("`git status` وأيضا\n\n```sh\n# تعليق\ngit status\n```");
    // The paragraph around it still reads right-to-left; only the code opts out.
    expect(html).toContain('<p dir="auto">');
    expect(html).toContain('<code data-inline-code="" dir="ltr">git status</code>');
    expect(html).toContain('<div dir="ltr" class="chat-markdown-codeblock');
  });

  it("gives a GitHub alert's body its own direction under LTR callout chrome", async () => {
    // The alert renderer builds its own element, so the blockquote cannot be the
    // marked block — the body paragraphs have to carry the direction instead.
    const html = await renderHtml("> [!NOTE]\n> مرحبا بالعالم.");
    expect(html).toContain('<p dir="auto">مرحبا بالعالم.</p>');
    expect(html).not.toContain("<blockquote");
  });

  it("flips the alert's own chrome for an RTL body, not just the body text", async () => {
    // The container hardcodes `dir="auto"`, whose native scan stops at the body
    // paragraph's own `dir` — so the side its border and icon sit on comes from
    // the direction computed in the mdast pass and threaded through as data.
    const html = await renderHtml("> [!NOTE]\n> مرحبا بالعالم.");
    expect(html).toContain('role="note" dir="rtl"');
  });

  it("keeps an English alert's chrome on the left", async () => {
    const html = await renderHtml("> [!WARNING]\n> Careful with this.");
    expect(html).toContain('role="note" dir="ltr"');
  });

  it("pins a file-link chip left-to-right even inside right-to-left prose", async () => {
    // The `code` renderer swaps the chip in for the `<code dir="ltr">` it
    // replaces, so a path in an Arabic sentence keeps its own reading order.
    const html = await renderHtml("عدّل `src/main.ts` من فضلك.");
    // The chip renders as an anchor or, with no primary action, a button —
    // either way it carries the LTR pin.
    expect(html).toMatch(/<(a|button)[^>]* dir="ltr"/);
  });

  it("gives a table its base direction from its own content, cells still self-resolve", async () => {
    // The direction sits on the scroll viewport wrapping the table, so an
    // overflowing Hebrew/Arabic table opens at its first, rightmost column.
    const html = await renderHtml("| اسم | value |\n| --- | --- |\n| قيمة | 1 |");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('<th dir="auto">');
    expect(html).toContain('<td dir="auto">');
  });

  it("keeps an English table left-to-right", async () => {
    const html = await renderHtml("| Name | value |\n| --- | --- |\n| a | 1 |");
    expect(html).not.toContain('dir="rtl"');
  });

  it('keeps a Hebrew block opening with an inline-code span on dir="auto"', async () => {
    // The code span carries its own dir="ltr", so both the plugin's detection
    // text and the browser's dir="auto" scan skip it — no pin needed.
    const html = await renderHtml("`server.py` זה הקובץ הראשי");
    expect(html).toContain('<p dir="auto">');
    expect(html).not.toContain('<p dir="rtl">');
  });

  it("pins a Hebrew block that opens with a URL right-to-left", async () => {
    const html = await renderHtml("https://claude.ai זה האתר של קלוד");
    expect(html).toContain('<p dir="rtl">');
  });

  it("pins a Hebrew block that opens with a path right-to-left", async () => {
    const html = await renderHtml("src/main.ts זה הקובץ שצריך לערוך");
    expect(html).toContain('<p dir="rtl">');
  });

  it("pins a Hebrew list that opens with a tech token right-to-left, markers included", async () => {
    const html = await renderHtml("- server.py זה הקובץ\n- עוד פריט");
    expect(html).toContain('<ul dir="rtl">');
  });

  it("keeps an English block with one Hebrew word on the browser's own resolution", async () => {
    const html = await renderHtml("The word שלום means hello");
    expect(html).toContain('<p dir="auto">');
    expect(html).not.toContain('dir="rtl"');
  });

  it("keeps a pure English block on the browser's own resolution", async () => {
    const html = await renderHtml("English only, no tech tokens.");
    expect(html).toContain('<p dir="auto">');
    expect(html).not.toContain('dir="rtl"');
  });

  it('leaves a Hebrew-first block on dir="auto", unchanged', async () => {
    const html = await renderHtml("שלום, תריץ `git status` עכשיו");
    expect(html).toContain('<p dir="auto">');
    expect(html).not.toContain('<p dir="rtl">');
  });

  it("isolates a Latin run inside RTL prose so its quotes stay on the right sides", async () => {
    const html = await renderHtml('הבוט "סותר את Kapso" לגמרי');
    expect(html).toContain("<bdi>Kapso</bdi>");
  });

  it("keeps a compound Latin run whole inside one isolate", async () => {
    const html = await renderHtml("דמו = U1+U2+U3+U5, ההסלמה אחרי");
    expect(html).toContain("<bdi>U1+U2+U3+U5</bdi>");
  });

  it("leaves English blocks and code untouched by the isolation pass", async () => {
    const html = await renderHtml("Plain English `code span` here");
    expect(html).not.toContain("<bdi>");
    const rtlWithCode = await renderHtml("תריץ `git status` עכשיו");
    expect(rtlWithCode).toContain('<code data-inline-code="" dir="ltr">git status</code>');
  });

  it("keeps a link atomic inside RTL prose instead of slicing it into isolates", async () => {
    const html = await renderHtml("הקישור https://claude.ai/docs זה טוב");
    expect(html).not.toContain("<bdi>https");
  });

  it("gives a table opening with a tech-token cell its direction from its prose", async () => {
    const html = await renderHtml("| `id.ts` | שם |\n| --- | --- |\n| `a.py` | קובץ |");
    expect(html).toContain('dir="rtl"');
  });
});

describe("resolvedTextDirection", () => {
  it("discounts leading tech tokens when the text is RTL prose", () => {
    expect(resolvedTextDirection("https://claude.ai זה האתר של קלוד")).toBe("rtl");
    expect(resolvedTextDirection("server.py זה הקובץ הראשי")).toBe("rtl");
    expect(resolvedTextDirection("src/main.ts זה הקובץ")).toBe("rtl");
    expect(resolvedTextDirection("`git status` תריץ קודם")).toBe("rtl");
  });

  it("keeps English text left-to-right, one Hebrew word or none", () => {
    expect(resolvedTextDirection("The word שלום means hello")).toBe("ltr");
    expect(resolvedTextDirection("Hello world")).toBe("ltr");
    // Latin letters hold the majority here, so the leading English words decide.
    expect(resolvedTextDirection("Claude Code זה כלי")).toBe("ltr");
  });

  it("reads a Hebrew sentence that opens with a Latin prose label right-to-left", () => {
    expect(
      resolvedTextDirection('Next step (ישן): "מתחילים לבנות תחנה 1, לאט. החוסמים: 3 קבצים."'),
    ).toBe("rtl");
    expect(resolvedTextDirection("TL;DR: הפיצ׳ר עובד, נשאר רק לנקות את הקוד")).toBe("rtl");
    // A Latin-majority sentence quoting some Hebrew still reads left-to-right.
    expect(resolvedTextDirection("The customer wrote שלום וברכה in the ticket")).toBe("ltr");
  });

  it("discounts quoted and parenthesized Latin citations from the vote", () => {
    expect(resolvedTextDirection('PROFILE — הוספתי סעיף "Build-feedback call additions"')).toBe(
      "rtl",
    );
    expect(resolvedTextDirection("P1 — אסטרטגיות (product-lens):")).toBe("rtl");
    // A Hebrew quotation inside English prose keeps its vote — still LTR.
    expect(resolvedTextDirection('They titled it "ברוכים הבאים" and moved on quickly')).toBe("ltr");
  });

  it("keeps Hebrew-first text right-to-left, unchanged", () => {
    expect(resolvedTextDirection("שלום, זה טקסט עם Claude Code בתוכו")).toBe("rtl");
  });
});

describe("firstStrongDirection", () => {
  it("reads the first letter, skipping neutral digits and punctuation", () => {
    expect(firstStrongDirection("רכיב | סטטוס")).toBe("rtl");
    expect(firstStrongDirection("1. (שלב) ראשון")).toBe("rtl");
    expect(firstStrongDirection("\u{1E900}\u{1E92F} adlam")).toBe("rtl"); // astral RTL block
    expect(firstStrongDirection("Component | Status")).toBe("ltr");
    expect(firstStrongDirection("42 — Next.js then עברית")).toBe("ltr");
  });

  it("falls back to ltr when there is no strong character", () => {
    expect(firstStrongDirection("")).toBe("ltr");
    expect(firstStrongDirection("123 | 456")).toBe("ltr");
  });
});
