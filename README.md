# BondStats Sovereign Debt Data

Live data repository for the BondStats **Sovereign Debt Profiles**.

Recommended repository name:

`bondstats-sovereign-debt-data`

## Coverage

15 sovereigns:

United States, Japan, Italy, Germany, France, United Kingdom, Canada, Australia, Spain, Netherlands, Switzerland, Belgium, Austria, Portugal and Greece.

## Automated fields

The GitHub Action refreshes the core comparable fields:

- general government gross debt, % of GDP
- estimated gross debt stock in USD billions
- nominal GDP in USD billions
- fiscal balance, % of GDP
- real GDP growth
- inflation
- next-year IMF debt projection when available
- 2Y / 5Y / 10Y / 30Y sovereign yields where BondStats market data provides them
- 2s10s and 5s30s curve spreads where the required maturities exist

## Sources

Core fiscal data:
- IMF World Economic Outlook through the public DataMapper API

Bond-market data:
- BondStats Global Yield Curve Database where a live curve adapter exists
- BondStats global_yields.json as a fallback for additional sovereigns

Debt-management context:
- each national debt-management office / finance ministry is stored in the country configuration.

## API keys

No paid API key is required for V1.

## Ratings and maturity structure

Credit ratings and heterogeneous national debt-maturity statistics are intentionally kept in:

`data/manual-overrides.json`

They are not scraped automatically.

This avoids silently redistributing proprietary agency data and avoids pretending that national debt-management offices publish maturity buckets in one common API format.

The main BondStats country pages already support these fields. Once a curated value is entered in `manual-overrides.json`, the next Action run carries it into the country JSON automatically.

## Workflow

`.github/workflows/update-sovereign-debt.yml`

Runs twice on weekdays and can be triggered manually.

## Main-site data URLs

Example:

`https://raw.githubusercontent.com/Botapi33/bondstats-sovereign-debt-data/main/data/countries/us.json`

The standalone page is diagnostics-only and should stay noindex. SEO belongs to the native pages on bondstats.org.
