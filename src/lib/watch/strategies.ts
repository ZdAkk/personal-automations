// Strategy registry — maps a SearchType to an executable search algorithm.
//
// Each Strategy takes one target and returns the listings that passed every
// filter. To add a new source (eBay, willhaben, a different Kleinanzeigen
// search style), implement SearchStrategy and register it under a new
// SearchType in STRATEGIES; the trigger dispatches purely on the string and
// needs no changes.

import {
  searchByUrl,
  buildCategoryUrl,
  listingMatches,
  parsePrice,
  type KleinanzeigenListing,
} from "../kleinanzeigen";
import type { SearchGroupSpec, SearchTarget, MatchedListing, SearchType } from "./types";

export interface SearchStrategy {
  run(
    group: SearchGroupSpec,
    target: SearchTarget,
    minPublishDate: string
  ): Promise<MatchedListing[]>;
}

// Keep VB/negotiable (null price); otherwise enforce the [min, max] window.
const withinPrice = (price: number | null, target: SearchTarget): boolean =>
  price === null || (price <= target.max_price && price >= (target.min_price ?? 0));

// Source: Kleinanzeigen, scoped to a category via /inserate-by-url. The URL
// carries the structural filters (category, offers-only, price band); the
// keyword require/exclude lists clean up what survives inside the category.
export const kleinanzeigenCategoryStrategy: SearchStrategy = {
  async run(group, target, minPublishDate) {
    const url = buildCategoryUrl({
      categorySlug: group.category.slug,
      categoryId: group.category.id,
      keyword: target.keyword,
      offersOnly: group.offersOnly,
      min_price: target.min_price,
      max_price: target.max_price,
    });

    const listings = await searchByUrl({
      url,
      max_pages: group.maxPages ?? 1,
      min_publish_date: minPublishDate,
    });

    return listings
      .filter((l: KleinanzeigenListing) =>
        listingMatches(l, { requireAll: target.requireAll, excludeAny: target.excludeAny })
      )
      .map((l) => ({ l, price_eur: parsePrice(l.price) }))
      .filter(({ price_eur }) => withinPrice(price_eur, target))
      .map(({ l, price_eur }) => ({
        targetId: target.id,
        label: target.label,
        adid: l.adid,
        title: l.title,
        price: l.price,
        price_eur,
        url: l.url,
        location: l.location,
        published_at: l.published_at,
      }));
  },
};

export const STRATEGIES: Record<SearchType, SearchStrategy> = {
  "kleinanzeigen-category": kleinanzeigenCategoryStrategy,
};

export function getStrategy(searchType: SearchType): SearchStrategy {
  const strategy = STRATEGIES[searchType];
  if (!strategy) throw new Error(`No search strategy registered for "${searchType}"`);
  return strategy;
}
