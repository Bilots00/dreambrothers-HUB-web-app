import { describe, it, expect } from "vitest";
import {
  parsePageIdInput, adsLibraryUrlForPage, mapScrapedAd,
  computeActiveDays, computeTrendingScore,
} from "./adsLibrary";

describe("parsePageIdInput", () => {
  it("accetta un page id numerico puro", () => {
    expect(parsePageIdInput("517850318391712")).toBe("517850318391712");
  });
  it("estrae view_all_page_id da un URL della Ads Library", () => {
    expect(parsePageIdInput("https://www.facebook.com/ads/library/?active_status=active&view_all_page_id=57577853810&search_type=page")).toBe("57577853810");
  });
  it("estrae id da facebook.com/profile.php?id=...", () => {
    expect(parsePageIdInput("https://www.facebook.com/profile.php?id=328810660605316")).toBe("328810660605316");
  });
  it("rifiuta input non riconoscibili", () => {
    expect(parsePageIdInput("nike")).toBeNull();
    expect(parsePageIdInput("")).toBeNull();
  });
});

describe("adsLibraryUrlForPage", () => {
  it("costruisce l'URL della Ads Library con il page id", () => {
    expect(adsLibraryUrlForPage("123456789")).toContain("view_all_page_id=123456789");
  });
});

describe("computeActiveDays / computeTrendingScore", () => {
  const now = new Date("2026-07-16T12:00:00Z");
  it("calcola i giorni di attività", () => {
    expect(computeActiveDays(new Date("2026-07-01T12:00:00Z"), now)).toBe(15);
    expect(computeActiveDays(null, now)).toBe(0);
  });
  it("score cresce con la longevità e dà bonus al video", () => {
    const shortImg = computeTrendingScore(5, false);
    const longImg = computeTrendingScore(60, false);
    const longVid = computeTrendingScore(60, true);
    expect(longImg).toBeGreaterThan(shortImg);
    expect(longVid).toBeGreaterThan(longImg);
    expect(computeTrendingScore(500, true)).toBeLessThanOrEqual(100);
  });
});

describe("mapScrapedAd", () => {
  const now = new Date("2026-07-16T12:00:00Z");

  it("mappa lo shape stile curious_coder (snapshot annidato, unix seconds)", () => {
    const item = {
      ad_archive_id: "12345",
      page_name: "iKonick",
      start_date: 1751500800, // 2025-07-03 circa (unix s)
      snapshot: {
        title: "Wall Art Sale",
        body: { text: "Your walls deserve better." },
        cta_text: "Shop Now",
        link_url: "https://ikonick.com",
        images: [{ original_image_url: "https://img.example/1.jpg" }],
        videos: [],
      },
    };
    const ad = mapScrapedAd(item, now)!;
    expect(ad.adArchiveId).toBe("12345");
    expect(ad.pageName).toBe("iKonick");
    expect(ad.title).toBe("Wall Art Sale");
    expect(ad.bodyText).toBe("Your walls deserve better.");
    expect(ad.ctaText).toBe("Shop Now");
    expect(ad.imageUrl).toBe("https://img.example/1.jpg");
    expect(ad.videoUrl).toBeNull();
    expect(ad.activeDays).toBeGreaterThan(300);
    expect(ad.score).toBeGreaterThan(50);
  });

  it("mappa video con thumbnail e camelCase alternativo", () => {
    const item = {
      adArchiveID: "999",
      pageName: "Gernucci",
      startDate: "2026-07-10",
      snapshot: {
        body_text: "Plain body",
        videos: [{ video_hd_url: "https://v.example/hd.mp4", video_preview_image_url: "https://v.example/thumb.jpg" }],
      },
    };
    const ad = mapScrapedAd(item, now)!;
    expect(ad.adArchiveId).toBe("999");
    expect(ad.videoUrl).toBe("https://v.example/hd.mp4");
    expect(ad.thumbnailUrl).toBe("https://v.example/thumb.jpg");
    expect(ad.bodyText).toBe("Plain body");
    expect(ad.activeDays).toBe(6);
  });

  it("scarta item senza ad_archive_id", () => {
    expect(mapScrapedAd({ snapshot: { title: "x" } }, now)).toBeNull();
  });

  // Regressione: le ads con più versioni/carosello tengono i media in cards[] e
  // prima venivano scartate come "senza media" → mancavano dal feed.
  it("estrae il media dai caroselli (cards[]) quando images/videos sono vuoti", () => {
    const item = {
      ad_archive_id: "777",
      page_name: "Andy okay",
      start_date: 1750000000,
      snapshot: {
        images: [],
        videos: [],
        cards: [
          { original_image_url: "https://img.example/card1.jpg", title: "Art for Causes", link_url: "https://andyokay.com", cta_text: "Shop now" },
          { original_image_url: "https://img.example/card2.jpg" },
        ],
      },
    };
    const ad = mapScrapedAd(item, now)!;
    expect(ad.imageUrl).toBe("https://img.example/card1.jpg");
    expect(ad.thumbnailUrl).toBe("https://img.example/card1.jpg");
    expect(ad.title).toBe("Art for Causes");
    expect(ad.landingUrl).toBe("https://andyokay.com");
  });

  it("estrae il logo dell'advertiser da page_profile_picture_url", () => {
    const item = {
      ad_archive_id: "888",
      page_name: "Andy okay",
      snapshot: {
        page_profile_picture_url: "https://scontent.fbcdn.net/logo.jpg",
        images: [{ resized_image_url: "https://img.example/a.jpg" }],
      },
    };
    const ad = mapScrapedAd(item, now)!;
    expect(ad.pageProfilePictureUrl).toBe("https://scontent.fbcdn.net/logo.jpg");
    expect(ad.imageUrl).toBe("https://img.example/a.jpg");
  });
});
