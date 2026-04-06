# news2reader

Server that offers webpages from popular news aggregators as EPUB files via ODPS,
for consumption via e-reader software (such as [KOReader](https://koreader.rocks/)).

## What it does

Many e-readers and other e-book reading software support browsing and
downloading e-books from sources called OPDS Catalogs. ([Wikipedia](https://en.wikipedia.org/wiki/Open_Publication_Distribution_System)) ([Supported software](https://wiki.mobileread.com/wiki/OPDS#eBook_Reading_Software_Supporting_OPDS))

**news2reader** acts as an OPDS Catalog, but instead of listing books it
lists current articles from sources like Hacker News, Tildes.net, and Pocket. When you
select an article for download, the article is automatically converted into a 
readable EPUB file and downloaded to your device.

### Screenshots

|   |   |   |
| - | - | - |
| ![1](https://github.com/BHSPitMonkey/news2reader/assets/33672/a0b1186f-61b0-4624-af9e-3e8a84a92d47) | ![2](https://github.com/BHSPitMonkey/news2reader/assets/33672/89dadc7e-4489-4824-91df-f999cdf76df4) | ![3](https://github.com/BHSPitMonkey/news2reader/assets/33672/b21125e9-245a-4c24-903c-bd5caf1c7eb6) |
| ![4](https://github.com/BHSPitMonkey/news2reader/assets/33672/06c38188-7a48-473e-a446-8fb20b8beb4b) | ![5](https://github.com/BHSPitMonkey/news2reader/assets/33672/5177d71c-27db-4629-bc9d-1953a909fbb6) | ![6](https://github.com/BHSPitMonkey/news2reader/assets/33672/bc01022c-a5bd-41cb-99e0-f5816003cf59) |
| ![7](https://github.com/BHSPitMonkey/news2reader/assets/33672/7030392a-c130-4fa4-9c58-77512d698bbc) | ![8](https://github.com/BHSPitMonkey/news2reader/assets/33672/eff9ac5a-3ce5-4bc4-a2c1-b0bd767d1e09) | ![9](https://github.com/BHSPitMonkey/news2reader/assets/33672/b48088f5-28ef-43eb-9fdb-1589d372c385) |

## How it works

**news2reader** is powered mainly by:

- [OPDS](https://opds.io/) (the protocol)
- [Node.js](https://nodejs.org/) (the JavaScript runtime)
- [TypeScript](https://www.typescriptlang.org/) (the programming language)
- [Express](https://expressjs.com/) (the web framework)
- [Readability](https://github.com/mozilla/readability) (for making readable versions of web pages)
- [epub-gen](https://github.com/cyrilis/epub-gen) (for turning readable web pages into EPUB files)

## How to run it

### Run via Docker

Docker images are available for `amd64`, `arm/v7`, and `arm64/v8` architectures.

```shell
docker run --expose 8080 bhspitmonkey/news2reader:main
```

Or, to add to a Docker Compose stack:

```yaml
version: "3.9"
services:
  server:
    image: bhspitmonkey/news2reader:main
    container_name: news2reader
    restart: unless-stopped
    volumes:
      - ./config/:/root/.config/news2reader/
    ports:
      - 8080:8080
```

You will need to mount a config directory at `/root/.config/news2reader/` in the container (as shown above).

### Run via Node.js

(Tested using Node 22.x)

```shell
yarn install
yarn start
```

## Configuration

Pocket's official service ends on July 8, 2025. To use news2reader with an API-compatible Pocket alternative,
you can override the following two environment variables (e.g. in your `docker-compose.yml`):

| Environment variable name | Default value                    |
| ------------------------- | -------------------------------- |
| `POCKET_BASE_URL`         | `https://getpocket.com`          |
| `POCKET_API_CONSUMER_KEY` | `108332-4cb01719bb01deabce69438` |

## How to use it

Start by opening the homepage in a web browser to make sure the application is running as expected.
This might be at the URL http://localhost:8080, but this could vary based on how you've configured things
so be sure to replace `localhost:8080` in these examples with the appropriate host and port in your situation.

You should see a simple status page including instructions for (optionally) setting up a Pocket account.

Next, you'll need to add a new ODPS catalog into whichever e-reader software you are using. If using KOReader,
you navigate from the main screen to 🔎 » ODPS catalog, then tap the "+" icon in the corner to begin adding a
new catalog. The catalog URL is just the URL you're running the server at, plus `/odps` at the end (for example:
`http://localhost:8080`).

## How to build it

Run the development server (which will hot-reload and recompile on the fly):

```shell
yarn install
yarn run dev
```

## License

MIT (see LICENSE.md for the full terms)
