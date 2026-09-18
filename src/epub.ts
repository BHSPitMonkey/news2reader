import { tmpdir } from "node:os";
import { URL } from "node:url";
import Epub from "epub-gen";
import jsdom from "jsdom";
import { Readability } from "@mozilla/readability";
import got from "got";

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
        data: article.content,
        beforeToc: true,
      },
    ],
    tempDir: tmpdir(),
  }).promise;

  console.log(`EPUB saved to ${outputPath}`);
  return outputPath;
}

/**
 * Build an EPUB directly from HTML content we already have (e.g. Readwise
 * Reader's `html_content`), skipping the fetch + Readability step used by
 * `articleToEpub`. This preserves content that a re-fetch would lose
 * (paywalled articles, newsletters/emails, reader-mode cleanups, etc).
 */
export async function htmlToEpub(options: {
  html: string;
  title: string;
  outputPath: string;
  author?: string | null;
  publisher?: string | null;
}): Promise<string> {
  const { html, title, outputPath, author, publisher } = options;

  await new Epub({
    output: outputPath,
    title,
    author: author ?? undefined,
    publisher: publisher ?? undefined,
    // epub-gen (0.1.0) does not expose a way to set the OPF dc:identifier;
    // it generates its own UUID. The Readwise document id is instead carried
    // in the OPDS entry <id> and the EPUB filename. If the v2 KOSync mapping
    // needs an in-file identifier, revisit this (custom builder or post-process).
    content: [
      {
        title,
        author: author ?? undefined,
        data: html,
        beforeToc: true,
      },
    ],
    tempDir: tmpdir(),
  }).promise;

  console.log(`EPUB saved to ${outputPath}`);
  return outputPath;
}
