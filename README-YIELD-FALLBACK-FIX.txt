BondStats Sovereign Debt Data — Global 10Y Yield Fallback Fix

Apply this as a normal overlay to:
bondstats-sovereign-debt-data

Changed only:
scripts/update-sovereign-debt.mjs

What was wrong:
BondStats global_yields.json stores each country's 10-year yield directly in:

countries.<country>.value

Example shape:
countries.italy.value
countries.france.value
countries.canada.value

The original sovereign-debt parser found the country object but searched for an
inner "10Y" key, so the fallback returned null.

What this patch changes:
- reads the real countries.<slug>.value field as the 10Y yield
- reads countries.<slug>.date as the market as-of date
- preserves frequency/source/tier metadata
- retains the generic parser as a defensive fallback
- keeps Curve Atlas data preferred where available

After applying:
Run Actions → Update Sovereign Debt Profiles → Run workflow once.

Expected result:
10Y values should populate for countries supplied by global_yields.json,
including Italy, France, Canada, Spain, Netherlands, Switzerland, Belgium,
Austria, Portugal and Greece.
