import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const COUNTRIES = JSON.parse(await fs.readFile(path.join(ROOT,'config/countries.json'),'utf8'));
const MANUAL = JSON.parse(await fs.readFile(path.join(ROOT,'data/manual-overrides.json'),'utf8'));

const IMF_BASE = 'https://www.imf.org/external/datamapper/api/v1';
const GLOBAL_YIELDS = 'https://botapi33.github.io/bondstats-global-yields/global_yields.json';
const CURVE_RAW_BASE = 'https://raw.githubusercontent.com/Botapi33/bondstats-global-yield-curve-database/main/data/markets';

const INDICATORS = {
  debtGdp: 'GGXWDG_NGDP',
  fiscalBalance: 'GGXCNL_NGDP',
  nominalGdpUsdBn: 'NGDPD',
  realGrowth: 'NGDP_RPCH',
  inflation: 'PCPIPCH'
};

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function fetchText(url, attempts=3){
  let last;
  for(let i=0;i<attempts;i++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),25000);
    try{
      const res=await fetch(url,{
        headers:{'user-agent':'BondStats-Sovereign-Debt-Data/1.0','accept':'application/json,text/plain,*/*'},
        signal:controller.signal
      });
      clearTimeout(timer);
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    }catch(e){
      clearTimeout(timer);
      last=e;
      await sleep(900*(i+1));
    }
  }
  throw last;
}

async function fetchJson(url){
  return JSON.parse(await fetchText(url));
}

function round(x,n=2){
  if(x==null || !Number.isFinite(Number(x))) return null;
  const p=10**n;
  return Math.round(Number(x)*p)/p;
}

function latestAtOrBefore(series, year){
  if(!series || typeof series!=='object') return null;
  const years=Object.keys(series).map(Number).filter(Number.isFinite).filter(y=>y<=year).sort((a,b)=>b-a);
  if(!years.length) return null;
  const y=years[0], v=Number(series[String(y)]);
  return Number.isFinite(v)?{year:y,value:v}:null;
}

function exactYear(series, year){
  if(!series || typeof series!=='object') return null;
  const v=Number(series[String(year)]);
  return Number.isFinite(v)?{year,value:v}:null;
}

function extractImfSeries(payload, indicator, code){
  return payload?.values?.[indicator]?.[code] || {};
}

async function fetchImfBundle(){
  const codes=COUNTRIES.map(c=>c.imf).join('/');
  const out={};
  for(const [name,indicator] of Object.entries(INDICATORS)){
    const url=`${IMF_BASE}/${indicator}/${codes}`;
    const payload=await fetchJson(url);
    out[name]={indicator,url,payload};
  }
  return out;
}

function normalizeKey(s){
  return String(s??'').toLowerCase().replace(/[^a-z0-9]/g,'');
}

function findCountryNode(root,country){
  const aliases=[
    country.id,country.code,country.imf,country.name,country.slug,
    country.name.replace('United Kingdom','UK').replace('United States','USA')
  ].map(normalizeKey);

  const seen=new Set();
  function walk(node,depth=0){
    if(node==null || depth>7) return null;
    if(typeof node!=='object') return null;
    if(seen.has(node)) return null;
    seen.add(node);

    if(!Array.isArray(node)){
      for(const [k,v] of Object.entries(node)){
        const nk=normalizeKey(k);
        if(aliases.includes(nk) && v && typeof v==='object') return v;
      }
      const text=normalizeKey(
        [node.country,node.name,node.code,node.iso,node.iso3,node.market].filter(Boolean).join(' ')
      );
      if(text && aliases.some(a=>a && text.includes(a))) return node;
    }

    const values=Array.isArray(node)?node:Object.values(node);
    for(const v of values){
      const hit=walk(v,depth+1);
      if(hit) return hit;
    }
    return null;
  }
  return walk(root);
}

function numericFromObject(obj, patterns){
  if(!obj || typeof obj!=='object') return null;
  for(const [k,v] of Object.entries(obj)){
    const nk=normalizeKey(k);
    if(patterns.some(p=>nk.includes(normalizeKey(p)))){
      if(typeof v==='number' && Number.isFinite(v)) return v;
      if(typeof v==='string'){
        const n=Number(v.replace('%','').replace(',','.'));
        if(Number.isFinite(n)) return n;
      }
      if(v && typeof v==='object'){
        for(const key of ['value','yield','rate','last','current']){
          const n=Number(v[key]);
          if(Number.isFinite(n)) return n;
        }
      }
    }
  }
  return null;
}

function extractGlobalYield(root,country){
  const node=findCountryNode(root,country);
  if(!node) return {};
  return {
    y2:numericFromObject(node,['2y','2year','2yr']),
    y5:numericFromObject(node,['5y','5year','5yr']),
    y10:numericFromObject(node,['10y','10year','10yr']),
    y30:numericFromObject(node,['30y','30year','30yr'])
  };
}

async function fetchCurve(country){
  if(!country.curveId) return null;
  const url=`${CURVE_RAW_BASE}/${country.curveId}.json`;
  try{
    const d=await fetchJson(url);
    const row=d?.history?.[d.history.length-1];
    if(!row?.curve) return null;
    const c=row.curve;
    const pick=(...keys)=>{
      for(const k of keys){
        const n=Number(c[k]);
        if(Number.isFinite(n)) return n;
      }
      return null;
    };
    return {
      source:url,
      asOf:row.date || d.latestDate || null,
      y2:pick('2Y'),
      y5:pick('5Y'),
      y10:pick('10Y'),
      y30:pick('30Y','LONG')
    };
  }catch{
    return null;
  }
}

async function readPrevious(id){
  try{
    return JSON.parse(await fs.readFile(path.join(ROOT,'data/countries',`${id}.json`),'utf8'));
  }catch{
    return null;
  }
}

async function main(){
  const now=new Date();
  const currentYear=now.getUTCFullYear();
  const previousYear=currentYear-1;

  const catalog={
    version:1,status:'live',generatedAt:now.toISOString(),countryCount:COUNTRIES.length,countries:[]
  };

  let imfBundle;
  let globalYields=null;
  try{
    imfBundle=await fetchImfBundle();
  }catch(error){
    console.error('IMF bundle failed:',error.message);
    imfBundle=null;
  }

  try{
    globalYields=await fetchJson(GLOBAL_YIELDS);
  }catch(error){
    console.warn('Global yields fallback unavailable:',error.message);
  }

  let live=0;
  for(const country of COUNTRIES){
    const previous=await readPrevious(country.id);
    try{
      if(!imfBundle) throw new Error('IMF data unavailable');

      const debtSeries=extractImfSeries(imfBundle.debtGdp.payload,INDICATORS.debtGdp,country.imf);
      const balanceSeries=extractImfSeries(imfBundle.fiscalBalance.payload,INDICATORS.fiscalBalance,country.imf);
      const gdpSeries=extractImfSeries(imfBundle.nominalGdpUsdBn.payload,INDICATORS.nominalGdpUsdBn,country.imf);
      const growthSeries=extractImfSeries(imfBundle.realGrowth.payload,INDICATORS.realGrowth,country.imf);
      const inflationSeries=extractImfSeries(imfBundle.inflation.payload,INDICATORS.inflation,country.imf);

      const debt=latestAtOrBefore(debtSeries,currentYear) || latestAtOrBefore(debtSeries,previousYear);
      const gdp=debt ? exactYear(gdpSeries,debt.year) || latestAtOrBefore(gdpSeries,debt.year) : latestAtOrBefore(gdpSeries,currentYear);
      const balance=debt ? exactYear(balanceSeries,debt.year) || latestAtOrBefore(balanceSeries,debt.year) : latestAtOrBefore(balanceSeries,currentYear);
      const growth=debt ? exactYear(growthSeries,debt.year) || latestAtOrBefore(growthSeries,debt.year) : latestAtOrBefore(growthSeries,currentYear);
      const inflation=debt ? exactYear(inflationSeries,debt.year) || latestAtOrBefore(inflationSeries,debt.year) : latestAtOrBefore(inflationSeries,currentYear);
      const nextDebt=debt ? exactYear(debtSeries,debt.year+1) : null;

      if(!debt) throw new Error('No IMF debt observation');

      const curve=await fetchCurve(country);
      const fallback=globalYields ? extractGlobalYield(globalYields,country) : {};
      const market={
        asOf:curve?.asOf || null,
        y2:round(curve?.y2 ?? fallback.y2,3),
        y5:round(curve?.y5 ?? fallback.y5,3),
        y10:round(curve?.y10 ?? fallback.y10,3),
        y30:round(curve?.y30 ?? fallback.y30,3),
        curveSource:curve?.source || (Object.values(fallback).some(v=>v!=null)?GLOBAL_YIELDS:null)
      };
      market.s2s10 = market.y2!=null && market.y10!=null ? round((market.y10-market.y2)*100,1) : null;
      market.s5s30 = market.y5!=null && market.y30!=null ? round((market.y30-market.y5)*100,1) : null;

      const debtUsdBn=(gdp?.value!=null && debt?.value!=null) ? gdp.value*debt.value/100 : null;
      const override=MANUAL[country.id] || {};

      const output={
        version:1,status:'live',generatedAt:now.toISOString(),
        country:{
          id:country.id,code:country.code,imfCode:country.imf,name:country.name,slug:country.slug,
          currency:country.currency,bondMarket:country.bondMarket,centralBank:country.centralBank,
          dmo:country.dmo,dmoUrl:country.dmoUrl
        },
        fiscal:{
          referenceYear:debt.year,
          grossDebtPctGdp:round(debt.value,1),
          grossDebtUsdBn:round(debtUsdBn,1),
          nominalGdpUsdBn:round(gdp?.value,1),
          fiscalBalancePctGdp:round(balance?.value,1),
          realGrowthPct:round(growth?.value,1),
          inflationPct:round(inflation?.value,1),
          nextYearDebtPctGdp:round(nextDebt?.value,1),
          nextYear:nextDebt?.year || null
        },
        market,
        ratings:override.ratings || {},
        maturity:{
          averageMaturityYears:override.averageMaturityYears ?? null,
          buckets:Array.isArray(override.maturityBuckets)?override.maturityBuckets:[],
          asOf:override.maturityAsOf ?? null,
          sourceUrl:override.maturitySourceUrl || country.dmoUrl
        },
        history:{
          debtPctGdp:debtSeries,
          fiscalBalancePctGdp:balanceSeries
        },
        sources:[
          {name:'IMF World Economic Outlook / DataMapper',url:imfBundle.debtGdp.url,status:'ok'},
          {name:'BondStats Global Yield Curve Database',url:market.curveSource,status:market.curveSource?'ok':'unavailable'},
          {name:country.dmo,url:country.dmoUrl,status:'reference'}
        ]
      };

      await fs.writeFile(path.join(ROOT,'data/countries',`${country.id}.json`),JSON.stringify(output,null,2)+'\n');
      catalog.countries.push({
        id:country.id,code:country.code,name:country.name,slug:country.slug,status:'live',
        referenceYear:output.fiscal.referenceYear,grossDebtPctGdp:output.fiscal.grossDebtPctGdp,
        y10:output.market.y10
      });
      live++;
    }catch(error){
      console.error(`${country.id} failed:`,error.message);
      if(previous?.fiscal?.grossDebtPctGdp!=null){
        previous.status='stale';
        previous.refreshAttemptAt=now.toISOString();
        previous.lastError=String(error.message||error);
        await fs.writeFile(path.join(ROOT,'data/countries',`${country.id}.json`),JSON.stringify(previous,null,2)+'\n');
        catalog.countries.push({
          id:country.id,code:country.code,name:country.name,slug:country.slug,status:'stale',
          referenceYear:previous.fiscal.referenceYear,grossDebtPctGdp:previous.fiscal.grossDebtPctGdp,
          y10:previous.market?.y10 ?? null
        });
      }else{
        catalog.countries.push({
          id:country.id,code:country.code,name:country.name,slug:country.slug,status:'error',
          referenceYear:null,grossDebtPctGdp:null,y10:null,lastError:String(error.message||error)
        });
      }
    }
  }

  catalog.status = live===COUNTRIES.length ? 'live' : live>=10 ? 'partial' : live>0 ? 'degraded' : 'error';
  await fs.writeFile(path.join(ROOT,'data/catalog.json'),JSON.stringify(catalog,null,2)+'\n');

  if(live===0) throw new Error('No sovereign profile refreshed successfully.');
  console.log(`Sovereign debt data refreshed: ${live}/${COUNTRIES.length} live`);
}

main().catch(error=>{
  console.error(error);
  process.exit(1);
});
