import { tmpdir } from "node:os";
import { URL } from "node:url";
import Epub from "epub-gen";
import jsdom from "jsdom";
import { Readability } from "@mozilla/readability";
import got from "got";
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { jsdomAdaptor } from 'mathjax-full/js/adaptors/jsdomAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

const HEADERS = {
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'cache-control': 'no-cache',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.3',
};

const READABILITY_DEBUG = process.env.READABILITY_DEBUG === "1" || process.env.READABILITY_DEBUG === "true";

export async function articleToEpub(
  url: string,
  preferredTitle: string | null
) {
  const urlObj = new URL(url);
  const urlHost = urlObj.hostname;

  // TODO: Read/write EPUB into a cache dir by URL hash
  const outputPath = "/tmp/news2opds-out.epub";
  const virtualConsole = new jsdom.VirtualConsole();
  virtualConsole.on("jsdomError", (err) => console.error("JSDOM error:", err));
  virtualConsole.on("error", (err) => console.error("JSDOM console.error:", err));
  virtualConsole.on("warn", (msg) => console.warn("JSDOM console.warn:", msg));
  virtualConsole.on("info", (msg) => console.info("JSDOM console.info:", msg));
  virtualConsole.on("log", (msg) => console.log("JSDOM console.log:", msg));

  console.log(`Processing article at URL ${url} to path ${outputPath}`);

  const fetchStart = Date.now();
  const response = await got(url, {
    headers: HEADERS
  });
  const body = response.body;
  const rawContentType = response.headers["content-type"];
  const contentType = Array.isArray(rawContentType) ? rawContentType.join(", ") : rawContentType;
  console.log(`Fetched ${body.length} chars from ${url} in ${Date.now() - fetchStart}ms (status ${response.statusCode}, content-type: ${contentType ?? "unknown"})`);

  // Create a JSDOM
  const domStart = Date.now();
  const dom = new jsdom.JSDOM(body, { url, virtualConsole });
  console.log(`Constructed JSDOM in ${Date.now() - domStart}ms`);
  if (READABILITY_DEBUG) {
    console.log("Readability debug enabled (READABILITY_DEBUG).");
  }

  // Create Readable HTML
  const readabilityStart = Date.now();
  let reader = new Readability(dom.window.document, { debug: READABILITY_DEBUG, keepClasses: READABILITY_DEBUG });
  let article: any = null;
  try {
    article = reader.parse();
  } catch (err) {
    console.error("Readability.parse() threw an exception", err);
  }
  console.log(`Readability.parse() executed in ${Date.now() - readabilityStart}ms`);
  if (article === null) {
    const doc = dom.window.document;
    const bodyTextLength = doc.body?.textContent?.length ?? 0;
    const bodyHTMLLength = doc.body?.innerHTML?.length ?? 0;
    console.error("Readability failed to parse.", {
      url,
      baseURI: doc.baseURI,
      docTitle: doc.title,
      bodyTextLength,
      bodyHTMLLength,
      articleTags: doc.getElementsByTagName("article").length,
      mainTags: doc.getElementsByTagName("main").length,
      h1Tags: doc.getElementsByTagName("h1").length,
    });
    if (process.env.VERBOSE) {
      console.error("Document head HTML (first 5000 chars):", doc.head?.innerHTML?.slice(0, 5000));
      console.error("Document body HTML (first 5000 chars):", doc.body?.innerHTML?.slice(0, 5000));
    } else {
      console.error("Set VERBOSE=1 to include HTML snippets in logs.");
    }
    throw new Error('Failed to parse article using Readability');
  }
  console.log(`Parsed article:`, {
    title: article.title,
    byline: article.byline,
    length: article.length,
    excerpt: article.excerpt?.slice(0, 120),
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
