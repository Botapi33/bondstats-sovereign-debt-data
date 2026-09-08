import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(__dirname,'..');
const COUNTRIES=JSON.parse(await fs.readFile(path.join(ROOT,'config/countries.json'),'utf8'));
const MANUAL=JSON.parse(await fs.readFile(path.join(ROOT,'data/manual-overrides.json'),'utf8'));

const WB_API='https://api.worldbank.org/v2';
const EUROSTAT_API='https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/gov_10dd_edpt1';
const ECB_API='https://data-api.ecb.europa.eu/service/data';
const CURVE_RAW_BASE='https://raw.githubusercontent.com/Botapi33/bondstats-global-yield-curve-database/main/data/markets';

const WB_INDICATORS={
  debt:'GC.DOD.TOTL.GD.ZS',
  gdpUsd:'NY.GDP.MKTP.CD',
  fiscalBalance:'GC.BAL.CASH.GD.ZS',
  growth:'NY.GDP.MKTP.KD.ZG',
  inflation:'FP.CPI.TOTL.ZG'
};

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function round(x,n=2){
  if(x==null || !Number.isFinite(Number(x))) return null;
  const p=10**n;
  return Math.round(Number(x)*p)/p;
}
async function fetchText(url,attempts=3){
  let last;
  for(let i=0;i<attempts;i++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),25000);
    try{
      const res=await fetch(url,{
        headers:{'user-agent':'BondStats-Sovereign-Debt-Data/2.0','accept':'application/json,text/csv,text/plain,*/*'},
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
async function fetchJson(url){return JSON.parse(await fetchText(url));}

function splitCsvLine(line){
  const out=[]; let cur=''; let quoted=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(quoted && line[i+1]==='"'){cur+='"';i++;}
      else quoted=!quoted;
    }else if(ch===',' && !quoted){out.push(cur);cur='';}
    else cur+=ch;
  }
  out.push(cur);
  return out.map(x=>x.trim());
}
function parseCsv(text){
  return text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(splitCsvLine);
}
function parseNumber(v){
  if(v==null)return null;
  const n=Number(String(v).trim().replace('%','').replace(',','.'));
  return Number.isFinite(n)?n:null;
}

async function fetchWorldBankSeries(code,indicator){
  const url=`${WB_API}/country/${encodeURIComponent(code)}/indicator/${encodeURIComponent(indicator)}?format=json&per_page=100&date=1990:2030`;
  const payload=await fetchJson(url);
  const rows=Array.isArray(payload?.[1])?payload[1]:[];
  const series={};
  for(const row of rows){
    const year=String(row?.date||'');
    const value=Number(row?.value);
    if(/^\d{4}$/.test(year) && Number.isFinite(value)) series[year]=value;
  }
  return {url,series};
}

function latestSeriesValue(series,maxAgeYears=5){
  const current=new Date().getUTCFullYear();
  const years=Object.keys(series||{}).map(Number).filter(Number.isFinite).sort((a,b)=>b-a);
  for(const year of years){
    if(year<=current && current-year<=maxAgeYears){
      const value=Number(series[String(year)]);
      if(Number.isFinite(value)) return {year,value};
    }
  }
  return null;
}

function eurostatTimeSeries(payload){
  const idx=payload?.dimension?.time?.category?.index;
  const values=payload?.value || {};
  if(!idx)return {};
  const pairs=Array.isArray(idx)
    ? idx.map((year,pos)=>[year,pos])
    : Object.entries(idx).map(([year,pos])=>[year,Number(pos)]);
  const out={};
  for(const [year,pos] of pairs){
    const value=Number(values[String(pos)]);
    if(/^\d{4}$/.test(String(year)) && Number.isFinite(value)) out[String(year)]=value;
  }
  return out;
}

async function fetchEurostatFiscal(geo,item){
  const url=`${EUROSTAT_API}?lang=en&freq=A&unit=PC_GDP&sector=S13&na_item=${encodeURIComponent(item)}&geo=${encodeURIComponent(geo)}`;
  const payload=await fetchJson(url);
  return {url,series:eurostatTimeSeries(payload)};
}

async function fetchEcbLongRate(geo){
  const key=`M.${geo}.L.L40.CI.0000.EUR.N.Z`;
  const url=`${ECB_API}/IRS/${key}?format=csvdata`;
  const rows=parseCsv(await fetchText(url));
  if(!rows.length)return null;
  const header=rows[0].map(x=>x.toUpperCase());
  const di=header.indexOf('TIME_PERIOD');
  const vi=header.indexOf('OBS_VALUE');
  if(di<0||vi<0)return null;
  const obs=rows.slice(1)
    .map(r=>({date:r[di],value:parseNumber(r[vi])}))
    .filter(r=>r.date&&r.value!=null)
    .sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  return obs.length ? {url,asOf:obs[obs.length-1].date,y10:obs[obs.length-1].value} : null;
}

async function fetchCurve(country){
  if(!country.curveId)return null;
  const url=`${CURVE_RAW_BASE}/${country.curveId}.json`;
  try{
    const d=await fetchJson(url);
    const row=d?.history?.[d.history.length-1];
    if(!row?.curve)return null;
    const c=row.curve;
    const pick=(...keys)=>{
      for(const key of keys){
        const n=Number(c[key]);
        if(Number.isFinite(n))return n;
      }
      return null;
    };
    return {source:url,asOf:row.date||d.latestDate||null,y2:pick('2Y'),y5:pick('5Y'),y10:pick('10Y'),y30:pick('30Y','LONG')};
  }catch{return null;}
}

async function main(){
  const now=new Date();
  const catalog={version:2,status:'live',generatedAt:now.toISOString(),countryCount:COUNTRIES.length,countries:[]};
  let live=0;

  for(const country of COUNTRIES){
    try{
      const [gdpRes,growthRes,inflationRes]=await Promise.all([
        fetchWorldBankSeries(country.code,WB_INDICATORS.gdpUsd),
        fetchWorldBankSeries(country.code,WB_INDICATORS.growth),
        fetchWorldBankSeries(country.code,WB_INDICATORS.inflation)
      ]);
      const gdp=latestSeriesValue(gdpRes.series,5);
      const growth=latestSeriesValue(growthRes.series,5);
      const inflation=latestSeriesValue(inflationRes.series,5);

      let debtRes,balanceRes,debt,balance,debtDefinition,fiscalSource,fiscalLicense;

      if(country.eurostatGeo){
        [debtRes,balanceRes]=await Promise.all([
          fetchEurostatFiscal(country.eurostatGeo,'GD'),
          fetchEurostatFiscal(country.eurostatGeo,'B9')
        ]);
        debt=latestSeriesValue(debtRes.series,4);
        balance=latestSeriesValue(balanceRes.series,4);
        debtDefinition='General government consolidated gross debt (Maastricht debt), % of GDP';
        fiscalSource='Eurostat — Government deficit/surplus, debt and associated data (gov_10dd_edpt1)';
        fiscalLicense='https://ec.europa.eu/eurostat/help/copyright-notice';
      }else{
        [debtRes,balanceRes]=await Promise.all([
          fetchWorldBankSeries(country.code,WB_INDICATORS.debt),
          fetchWorldBankSeries(country.code,WB_INDICATORS.fiscalBalance)
        ]);
        debt=latestSeriesValue(debtRes.series,5);
        balance=latestSeriesValue(balanceRes.series,5);
        debtDefinition='Central government debt, total, % of GDP';
        fiscalSource='World Bank World Development Indicators';
        fiscalLicense='https://datacatalog.worldbank.org/public-licenses';
      }

      if(!debt)throw new Error('No recent rights-cleared debt observation');

      const curve=await fetchCurve(country);
      const ecbYield=country.eurostatGeo && !curve ? await fetchEcbLongRate(country.eurostatGeo) : null;
      const market={
        asOf:curve?.asOf || ecbYield?.asOf || null,
        y2:round(curve?.y2,3),
        y5:round(curve?.y5,3),
        y10:round(curve?.y10 ?? ecbYield?.y10,3),
        y30:round(curve?.y30,3),
        curveSource:curve?.source || ecbYield?.url || null
      };
      market.s2s10=market.y2!=null&&market.y10!=null?round((market.y10-market.y2)*100,1):null;
      market.s5s30=market.y5!=null&&market.y30!=null?round((market.y30-market.y5)*100,1):null;

      const debtUsdBn=(gdp?.value!=null&&debt?.value!=null)?gdp.value/1e9*debt.value/100:null;
      const override=MANUAL[country.id]||{};

      const output={
        version:2,status:'live',generatedAt:now.toISOString(),
        country:{
          id:country.id,code:country.code,name:country.name,slug:country.slug,
          currency:country.currency,bondMarket:country.bondMarket,centralBank:country.centralBank,
          dmo:country.dmo,dmoUrl:country.dmoUrl
        },
        fiscal:{
          referenceYear:debt.year,
          debtDefinition,
          grossDebtPctGdp:round(debt.value,1),
          grossDebtUsdBn:round(debtUsdBn,1),
          nominalGdpUsdBn:round(gdp?.value!=null?gdp.value/1e9:null,1),
          fiscalBalancePctGdp:round(balance?.value,1),
          realGrowthPct:round(growth?.value,1),
          inflationPct:round(inflation?.value,1),
          nextYearDebtPctGdp:null,
          nextYear:null
        },
        market,
        ratings:override.ratings||{},
        maturity:{
          averageMaturityYears:override.averageMaturityYears??null,
          buckets:Array.isArray(override.maturityBuckets)?override.maturityBuckets:[],
          asOf:override.maturityAsOf??null,
          sourceUrl:override.maturitySourceUrl||country.dmoUrl
        },
        history:{debtPctGdp:debtRes.series,fiscalBalancePctGdp:balanceRes.series},
        rights:{
          fiscal:{source:fiscalSource,licenseUrl:fiscalLicense},
          macro:{source:'World Bank World Development Indicators',licenseUrl:'https://datacatalog.worldbank.org/public-licenses'},
          market:{source:market.curveSource,licenseUrl:country.eurostatGeo&&!curve?'https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html':null},
          bondstatsNotice:'https://www.bondstats.org/data-license/'
        },
        sources:[
          {name:fiscalSource,url:debtRes.url,status:'ok',rights:fiscalLicense},
          {name:'World Bank World Development Indicators',url:gdpRes.url,status:'ok',rights:'https://datacatalog.worldbank.org/public-licenses'},
          {name:'Sovereign yield source',url:market.curveSource,status:market.curveSource?'ok':'unavailable'},
          {name:country.dmo,url:country.dmoUrl,status:'reference'}
        ]
      };

      await fs.writeFile(path.join(ROOT,'data/countries',`${country.id}.json`),JSON.stringify(output,null,2)+'\n');
      catalog.countries.push({
        id:country.id,code:country.code,name:country.name,slug:country.slug,status:'live',
        referenceYear:output.fiscal.referenceYear,grossDebtPctGdp:output.fiscal.grossDebtPctGdp,
        y10:output.market.y10,debtDefinition
      });
      live++;
    }catch(error){
      console.error(`${country.id} failed:`,error.message);
      // Rights-safe mode intentionally does not retain prior IMF/DataMapper values.
      await fs.writeFile(path.join(ROOT,'data/countries',`${country.id}.json`),JSON.stringify({
        version:2,status:'error',generatedAt:now.toISOString(),
        country:{
          id:country.id,code:country.code,name:country.name,slug:country.slug,
          currency:country.currency,bondMarket:country.bondMarket,centralBank:country.centralBank,
          dmo:country.dmo,dmoUrl:country.dmoUrl
        },
        fiscal:{},market:{},ratings:MANUAL[country.id]?.ratings||{},
        maturity:{averageMaturityYears:MANUAL[country.id]?.averageMaturityYears??null,buckets:[],asOf:null,sourceUrl:country.dmoUrl},
        history:{},rights:{bondstatsNotice:'https://www.bondstats.org/data-license/'},
        lastError:String(error.message||error)
      },null,2)+'\n');

      catalog.countries.push({
        id:country.id,code:country.code,name:country.name,slug:country.slug,status:'error',
        referenceYear:null,grossDebtPctGdp:null,y10:null,lastError:String(error.message||error)
      });
    }
  }

  catalog.status=live===COUNTRIES.length?'live':live>=10?'partial':live>0?'degraded':'error';
  await fs.writeFile(path.join(ROOT,'data/catalog.json'),JSON.stringify(catalog,null,2)+'\n');
  if(live===0)throw new Error('No rights-cleared sovereign profile refreshed.');
  console.log(`Rights-cleared sovereign data refreshed: ${live}/${COUNTRIES.length} live`);
}

main().catch(error=>{console.error(error);process.exit(1);});
