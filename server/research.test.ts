import { describe, expect, it } from "vitest";
import { parseRssItems, viralityFromEngagement, researchUrlHash } from "./research";

describe("parseRssItems", () => {
  it("estrae titolo, link, data e descrizione dagli <item>", () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title><![CDATA[Trend del momento]]></title><link>https://example.com/a</link>
        <pubDate>Tue, 14 Jul 2026 10:00:00 GMT</pubDate>
        <description><![CDATA[<b>Testo</b> con &amp; markup]]></description></item>
      <item><title>Secondo</title><link>https://example.com/b</link></item>
    </channel></rss>`;
    const items = parseRssItems(xml);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Trend del momento");
    expect(items[0].link).toBe("https://example.com/a");
    expect(items[0].pubDate?.getUTCHours()).toBe(10);
    expect(items[0].description).toBe("Testo con & markup");
  });

  it("estrae gli extras ht: di Google Trends", () => {
    const xml = `<rss><channel><item><title>parola trend</title>
      <ht:approx_traffic>50.000+</ht:approx_traffic>
      <ht:news_item_title>Notizia collegata</ht:news_item_title>
    </item></channel></rss>`;
    const items = parseRssItems(xml);
    expect(items[0].extras.approx_traffic).toBe("50.000+");
    expect(items[0].extras.news_item_title).toBe("Notizia collegata");
  });

  it("ignora item senza titolo e xml vuoto", () => {
    expect(parseRssItems("<rss></rss>")).toHaveLength(0);
    expect(parseRssItems("<item><link>x</link></item>")).toHaveLength(0);
  });
});

describe("viralityFromEngagement", () => {
  it("mappa l'engagement grezzo su 0-10 in scala logaritmica", () => {
    expect(viralityFromEngagement(0)).toBe(5); // nessuna metrica = neutro
    expect(viralityFromEngagement(100)).toBeGreaterThanOrEqual(4);
    expect(viralityFromEngagement(10_000)).toBeGreaterThanOrEqual(8);
    expect(viralityFromEngagement(1_000_000)).toBe(10);
  });
});

describe("researchUrlHash", () => {
  it("è deterministico e distingue url/titoli diversi", () => {
    expect(researchUrlHash("https://a.com", "t")).toBe(researchUrlHash("https://a.com", "t"));
    expect(researchUrlHash("https://a.com", "t")).not.toBe(researchUrlHash("https://b.com", "t"));
    expect(researchUrlHash(undefined, "solo titolo")).toHaveLength(64);
  });
});
