# Sovereign Debt Profile Methodology — Rights-Safe V2

Euro-area profiles use Eurostat general-government consolidated gross debt
(Maastricht debt), expressed as a percentage of GDP.

Non-euro profiles use the World Bank indicator `GC.DOD.TOTL.GD.ZS`:
Central government debt, total (% of GDP).

GDP, real growth and CPI inflation come from World Bank WDI.

Yield data prefers BondStats Curve Atlas files built from direct official-source
adapters. Euro-area sovereigns without a dedicated Curve Atlas adapter use ECB
long-term interest-rate statistics for convergence purposes.

Because the debt concept is not identical across all 15 countries, every JSON
file contains `fiscal.debtDefinition`. The site must show this field.

Ratings and heterogeneous national-DMO maturity statistics remain manual curated
fields. BondStats does not automatically scrape rating agencies.
