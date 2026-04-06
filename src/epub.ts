import { tmpdir } from "node:os";
import { URL } from "node:url";
import Epub from "epub-gen";
import jsdom from "jsdom";
import { Readability } from "@mozilla/readability";
import got from "got";
import { mathjax } from 'mathjax-full/js/mathjax';
import { TeX } from 'mathjax-full/js/input/tex';
import { SVG } from 'mathjax-full/js/output/svg';
import { jsdomAdaptor } from 'mathjax-full/js/adaptors/jsdomAdaptor';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages';

const HEADERS = {
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'cache-control': 'no-cache',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.3',
};

export async function articleToEpub(
  url: string,
  preferredTitle: string | null
) {
  const urlObj = new URL(url);
  const urlHost = urlObj.hostname;

  // TODO: Read/write EPUB into a cache dir by URL hash
  const outputPath = "/tmp/news2opds-out.epub";
  const virtualConsole = new jsdom.VirtualConsole();

  console.log(`Processing article at URL ${url} to path ${outputPath}`);

  const { body } = await got(url, {
    headers: HEADERS
  });
  console.log(`Fetched ${body.length} chars from ${url}`);

  // Create a JSDOM
  const dom = new jsdom.JSDOM(body, { url, virtualConsole });

  // Create Readable HTML
  let reader = new Readability(dom.window.document);
  let article = reader.parse();
  if (article === null) {
    throw new Error('Failed to parse article using Readability');
  }
  console.log(`Parsed article:`, {
    title: article.title,
    byline: article.byline,
    length: article.length,
  });

  // --- Add MathJax support to EPUB
  // We need a DOM for MathJax to process. We'll create one from the article content.
  const articleDom = new jsdom.JSDOM(article.content);
  const articleDocument = articleDom.window.document;

  // Pre-render MathJax equations to SVG and embed them in the EPUB content.
  const adaptor = jsdomAdaptor(articleDom.window);
  RegisterHTMLHandler(adaptor);

  const tex = new TeX({ packages: AllPackages });
  const svg = new SVG({ fontCache: 'none' });
  const mjDocument = mathjax.document(articleDocument, {
    InputJax: tex,
    OutputJax: svg,
  });

  mjDocument.render();

  const mathjaxCss = adaptor.textContent(svg.styleSheet(mjDocument) as HTMLElement);
  const processedContent = articleDocument.body.innerHTML;
  // ---

  const title = preferredTitle ?? article?.title ?? "Title Missing";

  // Build the EPUB at output_path
  await new Epub({
    output: outputPath,
    title: title,
    author: article?.byline,
    publisher: urlHost,
    content: [
      {
        title: title,
        author: article?.byline,
        data: processedContent,
        beforeToc: true,
      },
    ],
    css: mathjaxCss,
    tempDir: tmpdir(),
  }).promise;

  console.log(`EPUB saved to ${outputPath}`);
  return outputPath;
}
