import { ensureDir } from "https://deno.land/std@0.220.1/fs/mod.ts";
import {
  DOMParser,
  Element,
} from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";
import { Feed } from "npm:feed@4.2.2";

// couldn't use assertInstanceOf(element, Element)
// because it raised type error deno-ts(2345)
// with std@0.220.1 and TypeScript 5.3.3 bundled in Deno 1.41.3
// so wrote my own assertion
function ensureElement(element: unknown): asserts element is Element {
  if (!(element instanceof Element)) {
    throw new Error("not element");
  }
}

type Entry = {
  url: URL;
  title: string;
  publishedAt: Temporal.PlainDate;
  thumbnailUrl?: URL;
  corporation?: string;
};

function getThumbnailUrl($entry: Element): URL | undefined {
  const $imgs = $entry.getElementsByTagName("img");
  const $thumbnailImg = $imgs.find(($img) =>
    $img.parentElement?.className.startsWith("styles_ogImage")
  );
  if ($thumbnailImg === undefined) {
    return undefined;
  }
  const thumbnailRawUrl = $thumbnailImg.getAttribute("src");
  if (thumbnailRawUrl === null) {
    return undefined;
  }
  return new URL(thumbnailRawUrl);
}

function getCorporationName($entry: Element): string | undefined {
  const $allDesendants = $entry.getElementsByTagName("*");
  const $corporationName = $allDesendants.find(($elm) =>
    $elm.className.startsWith("styles_corporation")
  );
  if ($corporationName === undefined) {
    return undefined;
  }
  // assuming the first child is a TextNode whose content represents corporation name
  return $corporationName.firstChild.textContent;
}

function scrapeEntry($entry: Element): Entry {
  const $url = $entry.querySelector('[data-gtm-track-component="entry_main"]');
  const $title = $entry.querySelector("h4");
  if ($url === null || $title === null) {
    throw new Error("Failed to scrape required fields");
  }

  const rawUrl = $url.getAttribute("href");
  const title = $title.textContent;
  const published = $entry.getAttribute("data-gtm-track-post_date");
  if (rawUrl === null || published === null) {
    throw new Error("Failed to scrape required fields");
  }
  const url = new URL(rawUrl);
  // assuming `published` is in YYYY-MM-DD format
  const publishedAt = Temporal.PlainDate.from(published);

  return {
    url,
    title,
    publishedAt,
    thumbnailUrl: getThumbnailUrl($entry),
    corporation: getCorporationName($entry),
  };
}

function* scrapeTrendingEntries(rawHtml: string): Generator<Entry> {
  const parser = new DOMParser();
  const document = parser.parseFromString(rawHtml, "text/html");
  if (document === null) {
    throw new Error("Failed to parse as HTML");
  }
  const $trending = document.getElementById("trending");
  if ($trending === null) {
    throw new Error("Failed to scrape");
  }
  const $entries = $trending.querySelectorAll("[data-gtm-track-entry_id]");
  for (const $entry of $entries) {
    ensureElement($entry);
    yield scrapeEntry($entry);
  }
}

function buildFeed(entries: Iterable<Entry>) {
  const feed = new Feed({
    title: "はてなブログ企業技術ブログTrending",
    description:
      "はてなブログの企業技術ブログ（https://hatena.blog/dev）のTrendingの非公式フィード",
    id: "https://github.com/otariidae/hatena-blog-dev-trending-feed",
    link: "https://github.com/otariidae/hatena-blog-dev-trending-feed",
    language: "ja",
    copyright: "",
  });
  const tokyoTimeZone = new Temporal.TimeZone("Asia/Tokyo");
  for (const entry of entries) {
    const publishedAtZonedDateTime = entry.publishedAt.toZonedDateTime({
      timeZone: tokyoTimeZone,
    });
    feed.addItem({
      title: entry.title,
      id: entry.url.toString(),
      link: entry.url.toString(),
      date: new Date(publishedAtZonedDateTime.epochMilliseconds),
      image: entry.thumbnailUrl?.toString(),
      author: entry.corporation ? [{ name: entry.corporation }] : undefined,
    });
  }
  return feed;
}

async function main() {
  const response = await fetch("https://hatena.blog/dev");
  const rawHtml = await response.text();
  const entries = scrapeTrendingEntries(rawHtml);
  const feed = buildFeed(entries);
  await ensureDir("public");
  await Deno.writeTextFile("public/feed.json", feed.json1());
  await Deno.writeTextFile("public/atom.xml", feed.atom1());
  await Deno.writeTextFile("public/rss.xml", feed.rss2());
}

if (import.meta.main) {
  main();
}
