import { EnvironmentId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => vi.fn() }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/session")>()),
  usePreparedConnection: () => ({ _tag: "Loading" }),
}));
vi.mock("../state/entities", () => ({
  readThreadShell: () => null,
  useProjects: () => [],
}));
vi.mock("../remoteOpen", () => ({
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }),
}));
vi.mock("../editorPreferences", () => ({
  useOpenInPreferredEditor: () => vi.fn(),
  usePreferredEditor: () => [null, vi.fn()],
}));
vi.mock("~/lib/openPullRequestLink", () => ({
  findProjectForChangeRequest: () => undefined,
  matchesLinkedPullRequestUrl: () => false,
  parseChangeRequestUrl: () => null,
  useOpenChangeRequestLink: () => vi.fn(),
}));

import ChatMarkdown, {
  canUseMarkdownFileShellActions,
  firstStrongDirection,
  hasMarkdownFilePrimaryAction,
  orderedListGutterStyle,
  resolvedTextDirection,
  shouldUseMarkdownFileBrowserPrimaryAction,
} from "./ChatMarkdown";

describe("canUseMarkdownFileShellActions", () => {
  const environmentId = EnvironmentId.make("environment-1");

  it("allows editor and file manager actions for local environments", () => {
    expect(canUseMarkdownFileShellActions(environmentId, "local-exec", true)).toBe(true);
  });

  it("hides shell actions until the environment mode is resolved", () => {
    expect(canUseMarkdownFileShellActions(environmentId, "local-exec", false)).toBe(false);
  });

  it("hides editor and file manager actions for remote environments", () => {
    expect(canUseMarkdownFileShellActions(environmentId, "remote-links", true)).toBe(false);
    expect(canUseMarkdownFileShellActions(environmentId, "remote-unavailable", true)).toBe(false);
  });

  it("hides shell actions when no environment owns the markdown", () => {
    expect(canUseMarkdownFileShellActions(null, "local-exec", true)).toBe(false);
  });
});

describe("hasMarkdownFilePrimaryAction", () => {
  it("keeps the chip interactive when an editor, browser, or panel can open it", () => {
    expect(
      hasMarkdownFilePrimaryAction({
        canOpenInEditor: true,
        canOpenInBrowser: false,
        canOpenInPanel: false,
      }),
    ).toBe(true);
    expect(
      hasMarkdownFilePrimaryAction({
        canOpenInEditor: false,
        canOpenInBrowser: true,
        canOpenInPanel: false,
      }),
    ).toBe(true);
    expect(
      hasMarkdownFilePrimaryAction({
        canOpenInEditor: false,
        canOpenInBrowser: false,
        canOpenInPanel: true,
      }),
    ).toBe(true);
  });

  it("removes the link affordance when no primary action can open the file", () => {
    expect(
      hasMarkdownFilePrimaryAction({
        canOpenInEditor: false,
        canOpenInBrowser: false,
        canOpenInPanel: false,
      }),
    ).toBe(false);
  });
});

describe("ChatMarkdown file option chips", () => {
  it("keeps the fallback button text selectable", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown cwd="/tmp/project" text="[Source](/tmp/project/src/main.ts)" />,
    );

    expect(html).toContain("<button");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain("select-text");
  });

  it.each([true, false])(
    "renders Codex file citations as file chips with parseRawHtml=%s",
    (parseRawHtml) => {
      const html = renderToStaticMarkup(
        <ChatMarkdown
          cwd="/tmp/project"
          text={
            'Created :codex-file-citation{path="/tmp/project/outputs/report.xlsx" purpose="output"}.'
          }
          lineBreaks={!parseRawHtml}
          parseRawHtml={parseRawHtml}
        />,
      );

      expect(html).not.toContain("codex-file-citation");
      expect(html).toContain("chat-markdown-file-link");
      expect(html).toContain(
        'data-markdown-copy="[report.xlsx](/tmp/project/outputs/report.xlsx)"',
      );
      expect(html).toContain("report.xlsx");
    },
  );

  it("leaves an unfinished streaming citation visible until it is complete", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="/tmp/project"
        text={'Created :codex-file-citation{path="/tmp/project/outputs/report.xlsx"'}
        isStreaming
      />,
    );

    expect(html).toContain(":codex-file-citation");
    expect(html).not.toContain("chat-markdown-file-link");
  });

  it("leaves malformed and similarly named file directives literal", () => {
    for (const text of [
      ':codex-file-citation{purpose="output"}',
      ':codex-file-citation-extra{path="/tmp/project/outputs/report.xlsx"}',
    ]) {
      const html = renderToStaticMarkup(<ChatMarkdown cwd="/tmp/project" text={text} />);

      expect(html).toContain(text.replaceAll('"', "&quot;"));
      expect(html).not.toContain("chat-markdown-file-link");
    }
  });

  it("preserves Codex file citation examples inside code", () => {
    const directive = ':codex-file-citation{path="/tmp/project/outputs/report.xlsx"}';
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="/tmp/project"
        text={`Example: \`${directive}\`\n\n\`\`\`text\n${directive}\n\`\`\``}
      />,
    );

    expect(html.match(/:codex-file-citation/g)).toHaveLength(2);
    expect(html).not.toContain("chat-markdown-file-link");
  });

  it("preserves escaped Codex file citations as literal text", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="/tmp/project"
        text={'Example: \\:codex-file-citation{path="/tmp/project/outputs/report.xlsx"}'}
      />,
    );

    expect(html).toContain(":codex-file-citation");
    expect(html).not.toContain("chat-markdown-file-link");
  });

  it("does not create a nested link for citations inside link text", () => {
    const directive = ':codex-file-citation{path="/tmp/project/outputs/report.xlsx"}';
    const html = renderToStaticMarkup(
      <ChatMarkdown cwd="/tmp/project" text={`[See ${directive}](https://example.com)`} />,
    );
    const renderedText = html.replace(/<[^>]+>/g, "");

    expect(renderedText).toContain("codex-file-citation");
    expect(html).not.toContain("chat-markdown-file-link");
  });

  it("renders file citations created by over-indented list recovery", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="/tmp/project"
        text={'-       Created :codex-file-citation{path="/tmp/project/outputs/report.xlsx"}'}
      />,
    );

    expect(html).not.toContain("<pre>");
    expect(html).toContain("Created ");
    expect(html).toContain("chat-markdown-file-link");
    expect(html).toContain("report.xlsx");
  });

  it("disambiguates Codex citations with the same basename", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="/tmp/project"
        text={
          'Changed :codex-file-citation{path="/tmp/project/src/index.ts"} and :codex-file-citation{path="/tmp/project/test/index.ts"}.'
        }
      />,
    );

    expect(html).toContain("index.ts · project/src");
    expect(html).toContain("index.ts · project/test");
  });

  it("preserves rejected citations created by over-indented list recovery", () => {
    const malformedHtml = renderToStaticMarkup(
      <ChatMarkdown
        cwd="/tmp/project"
        text={'Leading text before list.\n\n-       Bad :codex-file-citation{purpose="output"}'}
      />,
    );
    const nestedLinkHtml = renderToStaticMarkup(
      <ChatMarkdown
        cwd="/tmp/project"
        text={
          'Leading text before list.\n\n-       [Bad :codex-file-citation{path="/tmp/project/report.xlsx"}](https://example.com)'
        }
      />,
    );
    const nestedLinkText = nestedLinkHtml.replace(/<[^>]+>/g, "");

    // The list item carries dir="auto" like every other bidi leaf block; what
    // this asserts is that the rejected citation survives verbatim inside it.
    expect(malformedHtml).toContain(
      '<li dir="auto">Bad :codex-file-citation{purpose=&quot;output&quot;}</li>',
    );
    expect(nestedLinkText).toContain(
      "Bad :codex-file-citation{path=&quot;/tmp/project/report.xlsx&quot;}",
    );
  });
});

const ARTIFACT_TEMPLATE_DIRECTIVE =
  '::artifact-template{skill_name="artifact-template-hello-world" skill_directory="/Users/test/.codex/skills/artifact-template-hello-world" display_name="Hello World" artifact_kind="document"}';

describe("ChatMarkdown artifact-template cards", () => {
  it.each([true, false])("renders the Codex result card with parseRawHtml=%s", (parseRawHtml) => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="/tmp/project"
        text={ARTIFACT_TEMPLATE_DIRECTIVE}
        parseRawHtml={parseRawHtml}
        onUseArtifactTemplate={() => undefined}
      />,
    );

    expect(html).not.toContain("::artifact-template");
    expect(html).toContain("chat-markdown-artifact-template");
    expect(html).toContain('data-artifact-kind="document"');
    expect(html).toContain('data-markdown-copy="Hello World (Document template)\n\n"');
    expect(html).toContain('data-skill-name="artifact-template-hello-world"');
    expect(html).toContain("Hello World");
    expect(html).toContain("Document template");
    expect(html).toContain("Use template");
    expect(html).not.toContain("<p><div");
  });

  it("renders a passive card outside a composer-backed timeline", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown cwd="/tmp/project" text={ARTIFACT_TEMPLATE_DIRECTIVE} />,
    );

    expect(html).toContain("chat-markdown-artifact-template");
    expect(html).not.toContain("Use template");
  });

  it("leaves malformed and unfinished artifact-template directives literal", () => {
    const malformed =
      '::artifact-template{skill_name="artifact-template-hello-world" display_name="Hello World" artifact_kind="document"}';
    const unfinished = ARTIFACT_TEMPLATE_DIRECTIVE.slice(0, -1);

    for (const text of [malformed, unfinished]) {
      const html = renderToStaticMarkup(<ChatMarkdown cwd="/tmp/project" text={text} />);
      expect(html).toContain("::artifact-template");
      expect(html).not.toContain("chat-markdown-artifact-template");
    }
  });

  it("leaves escaped and similarly named artifact-template directives literal", () => {
    for (const text of [
      `\\${ARTIFACT_TEMPLATE_DIRECTIVE}`,
      ARTIFACT_TEMPLATE_DIRECTIVE.replace("::artifact-template", "::artifact-template-extra"),
    ]) {
      const html = renderToStaticMarkup(<ChatMarkdown cwd="/tmp/project" text={text} />);

      expect(html).toContain("::artifact-template");
      expect(html).not.toContain("chat-markdown-artifact-template");
    }
  });

  it("preserves artifact-template examples inside code", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="/tmp/project"
        text={`\`${ARTIFACT_TEMPLATE_DIRECTIVE}\`\n\n\`\`\`text\n${ARTIFACT_TEMPLATE_DIRECTIVE}\n\`\`\``}
      />,
    );

    expect(html.match(/::artifact-template/g)).toHaveLength(2);
    expect(html).not.toContain("chat-markdown-artifact-template");
  });
});

describe("shouldUseMarkdownFileBrowserPrimaryAction", () => {
  it("uses the browser when it is the only available primary action", () => {
    expect(
      shouldUseMarkdownFileBrowserPrimaryAction({
        iconPath: "/tmp/report.html",
        canOpenInEditor: false,
        canOpenInBrowser: true,
        canOpenInPanel: false,
      }),
    ).toBe(true);
  });

  it("preserves the normal editor and panel defaults for HTML files", () => {
    expect(
      shouldUseMarkdownFileBrowserPrimaryAction({
        iconPath: "/tmp/report.html",
        canOpenInEditor: true,
        canOpenInBrowser: true,
        canOpenInPanel: false,
      }),
    ).toBe(false);
    expect(
      shouldUseMarkdownFileBrowserPrimaryAction({
        iconPath: "/tmp/report.html",
        canOpenInEditor: false,
        canOpenInBrowser: true,
        canOpenInPanel: true,
      }),
    ).toBe(false);
  });

  it("continues to open PDF files in the browser by default", () => {
    expect(
      shouldUseMarkdownFileBrowserPrimaryAction({
        iconPath: "/tmp/report.pdf",
        canOpenInEditor: true,
        canOpenInBrowser: true,
        canOpenInPanel: true,
      }),
    ).toBe(true);
  });
});

describe("orderedListGutterStyle", () => {
  it("leaves the default gutter alone for single-digit lists", () => {
    expect(orderedListGutterStyle(9, undefined)).toBeUndefined();
  });

  it("widens the gutter for two-digit lists", () => {
    expect(orderedListGutterStyle(99, undefined)).toEqual({ "--list-gutter": "3ch" });
  });

  it("widens the gutter for a two-digit list that starts above 1", () => {
    // start=50 + 49 items => last marker is "98", still two digits.
    expect(orderedListGutterStyle(49, 50)).toEqual({ "--list-gutter": "3ch" });
  });

  it("widens the gutter once the last marker reaches three digits", () => {
    // item 100 is the bug from #6512: a 100-item list starting at 1.
    expect(orderedListGutterStyle(100, undefined)).toEqual({ "--list-gutter": "4ch" });
  });

  it("accounts for a non-default start attribute", () => {
    // start=95 + 9 items => last marker is "103", three digits.
    expect(orderedListGutterStyle(9, 95)).toEqual({ "--list-gutter": "4ch" });
    expect(orderedListGutterStyle(5, "999995")).toEqual({ "--list-gutter": "7ch" });
  });

  it("scales further for four-digit markers", () => {
    expect(orderedListGutterStyle(1000, undefined)).toEqual({ "--list-gutter": "5ch" });
  });

  it("uses the widest marker and includes a negative start's minus sign", () => {
    expect(orderedListGutterStyle(1001, -1000)).toEqual({ "--list-gutter": "6ch" });
    expect(orderedListGutterStyle(3, -15)).toEqual({ "--list-gutter": "4ch" });
    expect(orderedListGutterStyle(3, -5)).toEqual({ "--list-gutter": "3ch" });
  });

  it("treats a missing/zero item count as a single item", () => {
    expect(orderedListGutterStyle(0, undefined)).toBeUndefined();
    expect(orderedListGutterStyle(0, 100)).toEqual({ "--list-gutter": "4ch" });
  });
});

describe("ChatMarkdown Windows file links", () => {
  const environmentId = EnvironmentId.make("env-windows");

  it.each([true, false])("preserves drive paths with parseRawHtml=%s", (parseRawHtml) => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="C:/Users/shawn/project"
        environmentId={environmentId}
        text="[Open](C:/Users/shawn/project/src/main.ts)"
        lineBreaks={!parseRawHtml}
        parseRawHtml={parseRawHtml}
      />,
    );

    expect(html).toContain('href="C:/Users/shawn/project/src/main.ts"');
    expect(html).toContain("chat-markdown-file-link");
  });

  it.each([true, false])("normalizes backslashes with parseRawHtml=%s", (parseRawHtml) => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="C:/Users/shawn/project"
        environmentId={environmentId}
        text={String.raw`[Open](C:\Users\shawn\project\src\main.ts)`}
        lineBreaks={!parseRawHtml}
        parseRawHtml={parseRawHtml}
      />,
    );

    expect(html).toContain('href="C:/Users/shawn/project/src/main.ts"');
    expect(html).toContain("chat-markdown-file-link");
  });

  it.each([true, false])(
    "distinguishes same-named backslash paths with parseRawHtml=%s",
    (parseRawHtml) => {
      const html = renderToStaticMarkup(
        <ChatMarkdown
          cwd="C:/Users/shawn/project"
          environmentId={environmentId}
          text={String.raw`[Source](C:\Users\shawn\project\src\index.ts) and [Test](C:\Users\shawn\project\test\index.ts)`}
          lineBreaks={!parseRawHtml}
          parseRawHtml={parseRawHtml}
        />,
      );

      expect(html).toContain("index.ts · project/src");
      expect(html).toContain("index.ts · project/test");
    },
  );

  it.each([true, false])(
    "does not disambiguate the same file in links and inline code with parseRawHtml=%s",
    (parseRawHtml) => {
      const path = String.raw`C:\Users\shawn\project\src\main.ts`;
      const html = renderToStaticMarkup(
        <ChatMarkdown
          cwd="C:/Users/shawn/project"
          environmentId={environmentId}
          text={`[Source](${path}) and \`${path}\``}
          lineBreaks={!parseRawHtml}
          parseRawHtml={parseRawHtml}
        />,
      );

      expect(html.match(/chat-markdown-file-link/g)).toHaveLength(2);
      expect(html).not.toContain("main.ts ·");
    },
  );

  it.each([true, false])("preserves reference links with parseRawHtml=%s", (parseRawHtml) => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="C:/Users/shawn/project"
        environmentId={environmentId}
        text={"[Open][source]\n\n[source]: C:/Users/shawn/project/src/main.ts"}
        lineBreaks={!parseRawHtml}
        parseRawHtml={parseRawHtml}
      />,
    );

    expect(html).toContain('href="C:/Users/shawn/project/src/main.ts"');
    expect(html).toContain("chat-markdown-file-link");
  });

  it.each([true, false])("still rejects unsafe schemes with parseRawHtml=%s", (parseRawHtml) => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        cwd="C:/Users/shawn/project"
        environmentId={environmentId}
        text="[unsafe](javascript:alert(1)) and [unknown](d:alert(1))"
        lineBreaks={!parseRawHtml}
        parseRawHtml={parseRawHtml}
      />,
    );

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("d:alert");
    expect(html).not.toContain("chat-markdown-file-link");
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
    // The chip renders as an anchor or, with no primary action, a button —
    // either way it carries the LTR pin.
    expect(html).toMatch(/<(a|button)[^>]* dir="ltr"/);
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
