# news2reader

Server that offers webpages from popular news aggregators as EPUB files via ODPS,
for consumption via e-reader software (such as [KOReader](https://koreader.rocks/)).

## What it does

Many e-readers and other e-book reading software support browsing and
downloading e-books from sources called OPDS Catalogs. (Wikipedia)

**news2reader** acts as an OPDS Catalog, but instead of listing books it
lists current articles from sources like Hacker News and Pocket. When you
select an article for download, the article is automatically converted into a 
readable EPUB file and downloaded to your device.

## How it works

**news2reader** is powered mainly by:

- [OPDS](https://opds.io/) (the protocol)
- [Node.js](https://nodejs.org/) (the JavaScript runtime)
- [TypeScript](https://www.typescriptlang.org/) (the programming language)
- [Express](https://expressjs.com/) (the web framework)
- [Readability](https://github.com/mozilla/readability) (for making readable versions of web pages)
- [epub-gen](https://github.com/cyrilis/epub-gen) (for turning readable web pages into EPUB files)

## How to run it

```shell
yarn install
yarn run start
```

## How to build it

Run the development server (which will hot-reload and recompile on the fly):

```shell
yarn install
yarn run dev
```

## License

MIT (see LICENSE.md for the full terms)