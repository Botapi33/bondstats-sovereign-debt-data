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

Rights-safe V2 source policy:

- Euro-area sovereign debt and fiscal balance: Eurostat `gov_10dd_edpt1`
- Non-euro sovereign debt: World Bank World Development Indicators
- GDP, growth and CPI inflation: World Bank World Development Indicators
- Euro sovereign long-term yields where no Curve Atlas market exists: ECB IRS
- Sovereign curves where available: BondStats Global Yield Curve Database using direct official-source adapters

Direct IMF DataMapper automation and the generic `global_yields.json` fallback are removed from this version.

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
