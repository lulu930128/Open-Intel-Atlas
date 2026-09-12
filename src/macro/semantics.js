const transformations={index:"指數",level:"水準",rate:"比率",mom:"月增",yoy:"年增",qoq:"季增",qoq_annualized:"季增年率",change:"增減量",change_pct:"變動率",change_bps:"基點變動",annual_rate:"年率"};
const units={percent:"%",index:"指數",persons:"人",thousands_persons:"千人",usd:"美元",millions_usd:"百萬美元",billions_usd:"十億美元",basis_points:"基點",count:"筆",barrels:"桶",million_barrels:"百萬桶",bcf:"十億立方英尺",ratio:"比值",points:"點"};
export function displaySemantics(indicator) {
  const extraUnits={usd_per_hour:"美元／小時",hours:"小時"};
  const unitLabel=units[indicator.unit]||extraUnits[indicator.unit];
  if(!transformations[indicator.transformation]||!unitLabel)throw new TypeError("Unknown macro transformation or unit");
  const adjustment={SA:"季調",NSA:"未季調",NA:"不適用"}[indicator.seasonal_adjustment];
  if(!adjustment)throw new TypeError("Unknown seasonal adjustment");
  return {display_name:indicator.display_name||indicator.name,transformation_label:transformations[indicator.transformation],unit_label:unitLabel,
    value_suffix:indicator.unit==="percent"?"%":indicator.unit==="index"?"":` ${unitLabel}`,
    basis_label:`${transformations[indicator.transformation]} · ${adjustment}${indicator.index_base?` · ${indicator.index_base}`:""}`};
}
