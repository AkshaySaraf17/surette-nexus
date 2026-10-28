/**
 * Export the system documents to shareable formats:  npm run docs:export
 *
 *   docs/system-design.md  →  docs/exports/system-design.{html,pdf,docx}
 *   docs/system-flows.md   →  docs/exports/system-flows.{html,pdf,docx}
 *   docs/operations-guide.md → docs/exports/operations-guide.{html,pdf,docx}
 *
 * Mermaid diagrams are rendered once with headless Chrome (the installed Google Chrome) into
 * SVG (for HTML/PDF) and PNG (for Word) under docs/exports/diagrams/. Word files are produced
 * by Pandoc (free; `brew install pandoc`). Everything here is free/open-source tooling.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { marked } from "marked";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const docsDir = path.join(root, "docs");
const outDir = path.join(docsDir, "exports");
const diagramDir = path.join(outDir, "diagrams");
const mermaidJs = readFileSync(require.resolve("mermaid/dist/mermaid.min.js"), "utf8");

const DOCS = [
  { file: "system-design.md", name: "system-design", title: "Surette Nexus — System Design" },
  { file: "system-flows.md", name: "system-flows", title: "Surette Nexus — System and Data Flows" },
  { file: "operations-guide.md", name: "operations-guide", title: "Surette Nexus — Operations Guide" },
];

const CSS = `
  :root { --ink:#15130f; --ink2:#4f493f; --ink3:#6b655a; --line:#e4ded3; --gold:#86602a; --code:#f3efe7; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.55 "Inter", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: var(--ink); margin: 0; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 24px; }
  h1, h2, h3 { font-family: "Cormorant Garamond", "Iowan Old Style", Georgia, serif; line-height: 1.15; }
  h1 { font-size: 30pt; margin: 0 0 6px; }
  h2 { font-size: 19pt; margin: 30px 0 8px; padding-top: 8px; border-top: 1px solid var(--line); break-after: avoid; }
  h3 { font-size: 13.5pt; margin: 20px 0 6px; break-after: avoid; }
  p, li { color: var(--ink2); }
  a { color: var(--gold); }
  code { font: 9pt "JetBrains Mono", Menlo, monospace; background: var(--code); padding: 1px 4px; border-radius: 3px; }
  pre { background: var(--code); padding: 10px 12px; border-radius: 6px; overflow-x: auto; break-inside: avoid; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0 14px; font-size: 9pt; break-inside: auto; }
  th, td { border: 1px solid var(--line); padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: var(--code); font-weight: 600; }
  tr { break-inside: avoid; }
  blockquote { margin: 12px 0; padding: 8px 14px; border-left: 3px solid var(--gold); background: #faf7f1; color: var(--ink2); }
  figure.diagram { margin: 14px 0; text-align: center; break-inside: avoid; }
  figure.diagram svg { max-width: 100%; height: auto; }
  .cover { border-bottom: 2px solid var(--gold); padding-bottom: 14px; margin-bottom: 18px; }
  .cover p { margin: 4px 0; color: var(--ink3); font-size: 9.5pt; }
  .toc { columns: 2; font-size: 9.5pt; margin-bottom: 8px; }
  .toc a { color: var(--ink2); text-decoration: none; }
`;

function slug(text) {
  return text.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function renderDiagrams(page, docName, blocks) {
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const id = `${docName}-${String(i + 1).padStart(2, "0")}`;
    const svg = await page.evaluate(async ([code, domId]) => {
      const { svg } = await window.mermaid.render(domId, code);
      return svg;
    }, [blocks[i], `d${id.replace(/[^a-z0-9]/gi, "")}`]);
    writeFileSync(path.join(diagramDir, `${id}.svg`), svg);
    // PNG for Word: draw the SVG on a white page and screenshot it at 2x.
    await page.setContent(`<html><body style="margin:0;background:#fff"><div id="d" style="display:inline-block;padding:12px">${svg}</div></body></html>`);
    await page.addScriptTag({ content: mermaidJs });
    await page.locator("#d").screenshot({ path: path.join(diagramDir, `${id}.png`) });
    out.push({ id, svg });
  }
  return out;
}

async function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(diagramDir, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent("<html><body></body></html>");
  await page.addScriptTag({ content: mermaidJs });
  await page.evaluate(() => window.mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict", flowchart: { htmlLabels: false } }));

  for (const doc of DOCS) {
    const md = readFileSync(path.join(docsDir, doc.file), "utf8");
    const blocks = [];
    const withMarkers = md.replace(/```mermaid\n([\s\S]*?)```/g, (_, code) => {
      blocks.push(code);
      return `@@DIAGRAM_${blocks.length - 1}@@`;
    });

    // Render diagrams on a fresh page with mermaid loaded.
    await page.setContent("<html><body></body></html>");
    await page.addScriptTag({ content: mermaidJs });
    await page.evaluate(() => window.mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict", flowchart: { htmlLabels: false } }));
    const diagrams = await renderDiagrams(page, doc.name, blocks);

    // HTML (also the source for the PDF).
    const renderer = new marked.Renderer();
    const headings = [];
    renderer.heading = ({ tokens, depth }) => {
      const text = marked.Parser.parseInline(tokens);
      const id = slug(text);
      if (depth === 2) headings.push({ id, text });
      return `<h${depth} id="${id}">${text}</h${depth}>`;
    };
    let body = marked.parse(withMarkers.replace(/^# .*\n/, ""), { renderer, gfm: true });
    body = body.replace(/<p>@@DIAGRAM_(\d+)@@<\/p>|@@DIAGRAM_(\d+)@@/g, (_, a, b) => `<figure class="diagram">${diagrams[Number(a ?? b)].svg}</figure>`);
    const generated = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${doc.title}</title><style>${CSS}</style></head><body><main>
<div class="cover"><h1>${doc.title.replace("Surette Nexus — ", "")}</h1><p>Surette Nexus · Surette Real Estate, Waterville, Maine</p><p>Generated ${generated} from docs/${doc.file}</p></div>
<nav class="toc">${headings.map((h) => `<div><a href="#${h.id}">${h.text}</a></div>`).join("")}</nav>
${body}</main></body></html>`;
    writeFileSync(path.join(outDir, `${doc.name}.html`), html);

    // PDF via Chrome's print engine.
    const pdfPage = await ctx.newPage();
    await pdfPage.setContent(html, { waitUntil: "load" });
    await pdfPage.pdf({
      path: path.join(outDir, `${doc.name}.pdf`),
      format: "Letter",
      printBackground: true,
      margin: { top: "0.7in", bottom: "0.7in", left: "0.6in", right: "0.6in" },
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:7pt;color:#6b655a;width:100%;padding:0 0.6in;">${doc.title}</div>`,
      footerTemplate: `<div style="font-size:7pt;color:#6b655a;width:100%;padding:0 0.6in;text-align:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
    });
    await pdfPage.close();

    // Word via Pandoc, with diagrams as PNG images.
    const forWord = withMarkers.replace(/@@DIAGRAM_(\d+)@@/g, (_, n) => `![](diagrams/${diagrams[Number(n)].id}.png)`);
    const tmp = path.join(outDir, `${doc.name}.pandoc.md`);
    writeFileSync(tmp, forWord);
    execFileSync("pandoc", [tmp, "-o", path.join(outDir, `${doc.name}.docx`), "--toc", "--toc-depth=2", `--resource-path=${outDir}`, "--metadata", `title=${doc.title}`], { stdio: "inherit" });
    rmSync(tmp);
    console.log(`✓ ${doc.name}: html, pdf, docx (${diagrams.length} diagrams)`);
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
