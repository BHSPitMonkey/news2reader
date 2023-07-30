import { tmpdir } from "node:os";
import { URL } from "node:url";
import Epub from "epub-gen";
import jsdom from "jsdom";
import { Readability } from "@mozilla/readability";
import got from "got";

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

  const { body } = await got(url);
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
