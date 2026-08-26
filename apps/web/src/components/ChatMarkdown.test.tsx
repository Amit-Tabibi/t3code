import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import ChatMarkdown, {
  firstStrongDirection,
  orderedListGutterStyle,
  resolvedTextDirection,
} from "./ChatMarkdown";

describe("orderedListGutterStyle", () => {
  it("leaves the default gutter alone for single-digit lists", () => {
    expect(orderedListGutterStyle(9, undefined)).toBeUndefined();
  });

  it("leaves the default gutter alone for two-digit lists", () => {
    expect(orderedListGutterStyle(99, undefined)).toBeUndefined();
  });

  it("leaves the default gutter alone for a two-digit list that starts above 1", () => {
    // start=50 + 49 items => last marker is "98", still two digits.
    expect(orderedListGutterStyle(49, 50)).toBeUndefined();
  });

  it("widens the gutter once the last marker reaches three digits", () => {
    // item 100 is the bug from #6512: a 100-item list starting at 1.
    expect(orderedListGutterStyle(100, undefined)).toEqual({ "--list-gutter": "4ch" });
  });

  it("accounts for a non-default start attribute", () => {
    // start=95 + 9 items => last marker is "103", three digits.
    expect(orderedListGutterStyle(9, 95)).toEqual({ "--list-gutter": "4ch" });
  });

  it("scales further for four-digit markers", () => {
    expect(orderedListGutterStyle(1000, undefined)).toEqual({ "--list-gutter": "5ch" });
  });

  it("treats a missing/zero item count as a single item", () => {
    expect(orderedListGutterStyle(0, undefined)).toBeUndefined();
  });
});

describe("chat markdown text direction", () => {
  function render(text: string) {
    return renderToStaticMarkup(<ChatMarkdown text={text} cwd="/repo" />);
  }

  it("lets each block pick its own direction from its own text", () => {
    const html = render("English first.\n\nمرحبا بالعالم.");
    expect(html).toContain('<p dir="auto">English first.</p>');
    expect(html).toContain('<p dir="auto">مرحبا بالعالم.</p>');
  });

  it("marks headings, lists, and quotes so their markers follow the text", () => {
    const html = render("# عنوان\n\n- عنصر\n\n> اقتباس");
    expect(html).toContain('<h1 dir="auto">');
    // The list's gutter side is pinned from all its items together.
    expect(html).toContain('<ul dir="rtl">');
    expect(html).toContain('<blockquote dir="auto">');
  });

  it("gives every list item its own direction, so mixed lists keep each marker beside its text", () => {
    const html = render("- English item\n- פריט בעברית");
    expect(html).toContain('<ul dir="ltr">');
    expect(html).toContain('<li dir="auto">');
  });

  it("does not re-mark the blocks inside a claimed quote", () => {
    const html = render("> اقتباس");
    expect(html).not.toContain('<blockquote dir="auto">\n<p dir="auto">');
  });

  it("pins code left-to-right so an Arabic comment cannot reorder a snippet", () => {
    const html = render("`git status` وأيضا\n\n```sh\n# تعليق\ngit status\n```");
    // The paragraph around it still reads right-to-left; only the code opts out.
    expect(html).toContain('<p dir="auto">');
    expect(html).toContain('<code data-inline-code="" dir="ltr">git status</code>');
    expect(html).toContain('<div dir="ltr" class="chat-markdown-codeblock');
  });

  it("gives a GitHub alert's body its own direction under LTR callout chrome", () => {
    // The alert renderer builds its own element, so the blockquote cannot be the
    // marked block — the body paragraphs have to carry the direction instead.
    const html = render("> [!NOTE]\n> مرحبا بالعالم.");
    expect(html).toContain('<p dir="auto">مرحبا بالعالم.</p>');
    expect(html).not.toContain("<blockquote");
  });

  it("pins a file-link chip left-to-right even inside right-to-left prose", () => {
    // The `code` renderer swaps the chip in for the `<code dir="ltr">` it
    // replaces, so a path in an Arabic sentence keeps its own reading order.
    const html = render("عدّل `src/main.ts` من فضلك.");
    expect(html).toContain('<a dir="ltr"');
  });

  it("gives a table its base direction from its own content, cells still self-resolve", () => {
    // The direction sits on the scroll viewport wrapping the table, so an
    // overflowing Hebrew/Arabic table opens at its first, rightmost column.
    const html = render("| اسم | value |\n| --- | --- |\n| قيمة | 1 |");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('<th dir="auto">');
    expect(html).toContain('<td dir="auto">');
  });

  it("keeps an English table left-to-right", () => {
    const html = render("| Name | value |\n| --- | --- |\n| a | 1 |");
    expect(html).not.toContain('dir="rtl"');
  });

  it('keeps a Hebrew block opening with an inline-code span on dir="auto"', () => {
    // The code span carries its own dir="ltr", so both the plugin's detection
    // text and the browser's dir="auto" scan skip it — no pin needed.
    const html = render("`server.py` זה הקובץ הראשי");
    expect(html).toContain('<p dir="auto">');
    expect(html).not.toContain('<p dir="rtl">');
  });

  it("pins a Hebrew block that opens with a URL right-to-left", () => {
    const html = render("https://claude.ai זה האתר של קלוד");
    expect(html).toContain('<p dir="rtl">');
  });

  it("pins a Hebrew block that opens with a path right-to-left", () => {
    const html = render("src/main.ts זה הקובץ שצריך לערוך");
    expect(html).toContain('<p dir="rtl">');
  });

  it("pins a Hebrew list that opens with a tech token right-to-left, markers included", () => {
    const html = render("- server.py זה הקובץ\n- עוד פריט");
    expect(html).toContain('<ul dir="rtl">');
  });

  it("keeps an English block with one Hebrew word on the browser's own resolution", () => {
    const html = render("The word שלום means hello");
    expect(html).toContain('<p dir="auto">');
    expect(html).not.toContain('dir="rtl"');
  });

  it("keeps a pure English block on the browser's own resolution", () => {
    const html = render("English only, no tech tokens.");
    expect(html).toContain('<p dir="auto">');
    expect(html).not.toContain('dir="rtl"');
  });

  it('leaves a Hebrew-first block on dir="auto", unchanged', () => {
    const html = render("שלום, תריץ `git status` עכשיו");
    expect(html).toContain('<p dir="auto">');
    expect(html).not.toContain('<p dir="rtl">');
  });

  it("isolates a Latin run inside RTL prose so its quotes stay on the right sides", () => {
    const html = render('הבוט "סותר את Kapso" לגמרי');
    expect(html).toContain("<bdi>Kapso</bdi>");
  });

  it("keeps a compound Latin run whole inside one isolate", () => {
    const html = render("דמו = U1+U2+U3+U5, ההסלמה אחרי");
    expect(html).toContain("<bdi>U1+U2+U3+U5</bdi>");
  });

  it("leaves English blocks and code untouched by the isolation pass", () => {
    const html = render("Plain English `code span` here");
    expect(html).not.toContain("<bdi>");
    const rtlWithCode = render("תריץ `git status` עכשיו");
    expect(rtlWithCode).toContain('<code data-inline-code="" dir="ltr">git status</code>');
  });

  it("keeps a link atomic inside RTL prose instead of slicing it into isolates", () => {
    const html = render("הקישור https://claude.ai/docs זה טוב");
    expect(html).not.toContain("<bdi>https");
  });

  it("gives a table opening with a tech-token cell its direction from its prose", () => {
    const html = render("| `id.ts` | שם |\n| --- | --- |\n| `a.py` | קובץ |");
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
