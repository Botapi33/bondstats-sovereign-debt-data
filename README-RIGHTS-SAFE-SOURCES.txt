BondStats Sovereign Debt Data — Rights-Safe Source Architecture

Removes avoidable source-rights ambiguity from the automated V1 pipeline.

Removed:
- direct IMF DataMapper automation
- generic BondStats global_yields.json fallback

Used instead:
- Euro-area debt/fiscal data: Eurostat
- Non-euro debt: World Bank WDI CC BY-labelled dataset
- GDP/growth/inflation: World Bank WDI
- Euro sovereign 10Y fallback: ECB long-term interest-rate statistics
- Curve Atlas data remains preferred where a direct official-source adapter exists

Important:
Debt definitions now differ by source universe. The exact definition is stored
in fiscal.debtDefinition and must be shown on the country page.
