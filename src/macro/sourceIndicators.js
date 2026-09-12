// Canonical definitions for the official employment, GDP, claims and policy releases.
const make=(group,source,frequency,periodKind,rows)=>rows.map(([id,name,unit,transformation,adjustment,optional=false,offset=0])=>Object.freeze({
  id:`US_${id}`,name,display_name:name,country_code:"US",release_group:group,source_id:source,frequency,period_kind:periodKind,
  unit,transformation,seasonal_adjustment:adjustment,index_base:null,required_for_release_complete:!optional,release_period_offset:offset
}));
export const SOURCE_GROUPS={
  employment:{name:"Labor 就業與薪資",source_id:"bls-employment-release",calendar_source_id:"bls-employment-calendar",host:"www.bls.gov",period_kind:"month"},
  gdp:{name:"GDP 國內生產毛額",source_id:"bea-gdp-release",calendar_source_id:"bea-gdp-calendar",host:"www.bea.gov",period_kind:"quarter"},
  claims:{name:"Claims 失業保險申請",source_id:"dol-claims-release",calendar_source_id:"dol-claims-calendar",host:"www.dol.gov",period_kind:"week",week_convention:"ending_saturday",max_release_age_ms:8*86400000},
  fomc:{name:"FOMC 利率決議",source_id:"fed-fomc-release",calendar_source_id:"fed-fomc-calendar",host:"www.federalreserve.gov",period_kind:"event",watch:{before_ms:600000,after_ms:3600000,poll_ms:60000}}
};
export const SOURCE_INDICATORS=[
  ...make("employment","bls-employment-release","monthly","month",[
    ["NFP_CHANGE","非農就業人數增減","persons","change","SA"],
    ["UNEMPLOYMENT_RATE","失業率","percent","rate","SA"],
    ["AHE_MOM","平均時薪月增率","percent","mom","SA"],
    ["AHE_YOY","平均時薪年增率","percent","yoy","SA"],
    ["AHE_LEVEL","平均時薪","usd_per_hour","level","SA",true],
    ["PARTICIPATION_RATE","勞動參與率","percent","rate","SA",true],
    ["AVERAGE_WEEKLY_HOURS","平均每週工時","hours","level","SA",true]
  ]),
  ...make("gdp","bea-gdp-release","quarterly","quarter",[
    ["REAL_GDP_QOQ_ANNUALIZED","實質 GDP 季增年率","percent","qoq_annualized","SA"],
    ["NOMINAL_GDP_QOQ_ANNUALIZED","名目 GDP 季增年率","percent","qoq_annualized","SA",true],
    ["REAL_FINAL_SALES_PRIVATE_QOQ_ANNUALIZED","私人國內購買者實質最終銷售季增年率","percent","qoq_annualized","SA",true],
    ["GDP_RELEASE_PCE_QOQ_ANNUALIZED","PCE 物價季增年率","percent","qoq_annualized","SA",true],
    ["GDP_RELEASE_CORE_PCE_QOQ_ANNUALIZED","核心 PCE 物價季增年率","percent","qoq_annualized","SA",true]
  ]),
  ...make("claims","dol-claims-release","weekly","week",[
    ["INITIAL_CLAIMS","初領失業保險申請","count","level","SA"],
    ["CONTINUING_CLAIMS","續領失業保險申請","count","level","SA",false,-1],
    ["INITIAL_CLAIMS_4W_AVERAGE","初領申請四週平均","count","level","SA",true],
    ["INSURED_UNEMPLOYMENT_RATE","受保失業率","percent","rate","SA",true,-1]
  ]),
  ...make("fomc","fed-fomc-release","event","event",[
    ["FED_FUNDS_TARGET_LOWER","聯邦基金目標區間下限","percent","rate","NA"],
    ["FED_FUNDS_TARGET_UPPER","聯邦基金目標區間上限","percent","rate","NA"]
  ])
];
