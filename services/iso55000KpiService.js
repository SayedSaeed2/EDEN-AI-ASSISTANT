/**
 * services/iso55000KpiService.js
 * Complete ISO 55000 / ISO 55001 / SMRP KPI Governance & Db2 SQL Generator.
 * Adapted from iso55000_kpi_skill_v2_iso55000KpiSkills-v2.js
 */

import crypto from 'node:crypto';

// Shared in-memory store for Tier-2 ISO 55001 Corrective Action (CAPA) Proposals
export const KPI_PENDING_PROPOSALS = new Map();

/**
 * Pillar 1: Reliability & Availability KPIs (Clause 8 & 9.1)
 */
export function calculate_reliability_availability_kpis({
  total_period_hours,
  planned_downtime_hours = 0,
  unplanned_downtime_hours = 0,
  number_of_failures = 0,
  quality_rate_percent = 100,
  performance_rate_percent = 100,
}) {
  const totalHrs = Number(total_period_hours) || 720;
  const plannedDown = Number(planned_downtime_hours) || 0;
  const unplannedDown = Number(unplanned_downtime_hours) || 0;
  const failures = Number(number_of_failures) || 0;
  const operatingHours = Math.max(0, totalHrs - plannedDown - unplannedDown);

  const mtbf = failures > 0 ? operatingHours / failures : Infinity;
  const mttr = failures > 0 ? unplannedDown / failures : 0;

  const inherentAvail =
    operatingHours + unplannedDown > 0
      ? (operatingHours / (operatingHours + unplannedDown)) * 100
      : 100;

  const operationalAvail = totalHrs > 0 ? (operatingHours / totalHrs) * 100 : 100;

  const oee =
    (operationalAvail / 100) *
    (Number(performance_rate_percent) / 100) *
    (Number(quality_rate_percent) / 100) *
    100;

  const status =
    inherentAvail >= 98.0
      ? 'WORLD-CLASS (>=98%)'
      : inherentAvail >= 95.0
      ? 'ACCEPTABLE (95%-98%)'
      : 'CRITICAL BREACH (<95% - CAPA Required)';

  return {
    operatingHours: Number(operatingHours.toFixed(1)),
    totalHours: totalHrs,
    mtbfHours: mtbf === Infinity ? 'Infinite' : Number(mtbf.toFixed(2)),
    mttrHours: Number(mttr.toFixed(2)),
    inherentAvailability: `${inherentAvail.toFixed(2)}%`,
    operationalAvailability: `${operationalAvail.toFixed(2)}%`,
    oeePercent: `${oee.toFixed(2)}%`,
    status,
    summary: [
      'ISO 55001 Pillar 1 — Reliability & Availability KPIs (Clause 9.1):',
      `- Operating Time: ${operatingHours.toFixed(1)} hrs (out of ${totalHrs} total hrs)`,
      `- MTBF (Mean Time Between Failures): ${mtbf === Infinity ? 'Infinite (0 failures)' : mtbf.toFixed(2) + ' hrs'}`,
      `- MTTR (Mean Time To Repair): ${mttr.toFixed(2)} hrs`,
      `- Inherent Availability (Ai): ${inherentAvail.toFixed(2)}% [Benchmark: >=98.0%]`,
      `- Operational Availability (Ao): ${operationalAvail.toFixed(2)}% [Benchmark: >=95.0%]`,
      `- Overall Equipment Effectiveness (OEE): ${oee.toFixed(2)}% [World-Class: >=85.0%]`,
      `- ISO 55001 Performance Status: ${status}`
    ].join('\n')
  };
}

/**
 * Pillar 2: Work Management & Planning Efficiency (Clause 8.1)
 */
export function calculate_work_management_kpis({
  pm_completed_on_time,
  pm_total_scheduled,
  proactive_wo_hours,
  reactive_emergency_wo_hours,
  scheduled_wo_completed,
  total_wo_scheduled_weekly,
  total_backlog_labor_hours,
  available_weekly_craft_hours,
}) {
  const pmComp =
    Number(pm_total_scheduled) > 0
      ? (Number(pm_completed_on_time) / Number(pm_total_scheduled)) * 100
      : 100;

  const totalWoHours = Number(proactive_wo_hours) + Number(reactive_emergency_wo_hours);
  const proactivePct = totalWoHours > 0 ? (Number(proactive_wo_hours) / totalWoHours) * 100 : 0;
  const reactivePct =
    totalWoHours > 0 ? (Number(reactive_emergency_wo_hours) / totalWoHours) * 100 : 0;

  const schedComp =
    Number(total_wo_scheduled_weekly) > 0
      ? (Number(scheduled_wo_completed) / Number(total_wo_scheduled_weekly)) * 100
      : 100;

  const backlogWeeks =
    Number(available_weekly_craft_hours) > 0
      ? Number(total_backlog_labor_hours) / Number(available_weekly_craft_hours)
      : 0;

  const flags = [];
  if (pmComp < 90) flags.push('PM Compliance below 90% ISO threshold');
  if (reactivePct > 20) flags.push(`Reactive work (${reactivePct.toFixed(1)}%) exceeds 20% SMRP ceiling`);
  if (backlogWeeks < 2 || backlogWeeks > 6) {
    flags.push(`Backlog (${backlogWeeks.toFixed(1)} wks) outside healthy 2-4 week corridor`);
  }

  return {
    pmScheduleCompliance: `${pmComp.toFixed(1)}%`,
    proactivePercent: `${proactivePct.toFixed(1)}%`,
    reactivePercent: `${reactivePct.toFixed(1)}%`,
    weeklyScheduleCompliance: `${schedComp.toFixed(1)}%`,
    backlogWeeks: Number(backlogWeeks.toFixed(2)),
    findings: flags.length ? flags : ['All Work Management KPIs within world-class corridor.'],
    summary: [
      'ISO 55001 Pillar 2 — Work Management & Planning KPIs (Clause 8.1):',
      `- PM Schedule Compliance: ${pmComp.toFixed(1)}% [Target: >=95.0%]`,
      `- Proactive vs. Reactive Split: ${proactivePct.toFixed(1)}% Proactive / ${reactivePct.toFixed(1)}% Reactive [Benchmark: 80/20]`,
      `- Weekly Schedule Compliance: ${schedComp.toFixed(1)}% [Target: >=90.0%]`,
      `- Ready Backlog Volume: ${backlogWeeks.toFixed(2)} Crew-Weeks [Healthy Range: 2.0 - 4.0 Weeks]`,
      `- Governance Audit Findings: ${flags.length ? flags.join('; ') : 'All Work Management KPIs within world-class corridor.'}`
    ].join('\n')
  };
}

/**
 * Pillar 3: Financial & Lifecycle Costing (Clause 6.2 / ISO 15663)
 */
export function calculate_lifecycle_financial_kpis({
  annual_maintenance_cost_usd,
  replacement_asset_value_rav_usd,
  annual_energy_operating_cost_usd = 0,
  asset_remaining_useful_life_years = 10,
}) {
  const maintCost = Number(annual_maintenance_cost_usd);
  const rav = Number(replacement_asset_value_rav_usd);
  const energyCost = Number(annual_energy_operating_cost_usd);
  const rul = Number(asset_remaining_useful_life_years);

  if (rav <= 0 || isNaN(rav)) {
    return { error: 'Replacement Asset Value (RAV) must be greater than zero.' };
  }

  const maintPctRav = (maintCost / rav) * 100;
  const projectedRemainingOpex = (maintCost + energyCost) * rul;

  let assessment = 'OPTIMAL (1.5% - 3.0% RAV World-Class Benchmark)';
  if (maintPctRav > 5.0) {
    assessment = 'SEVERE OVER-SPEND (>5.0% RAV) — Evaluate Capex Replacement vs. Continued Opex Repair';
  } else if (maintPctRav > 3.5) {
    assessment = 'ELEVATED COST (3.5% - 5.0% RAV) — High reactive maintenance or aging asset drift';
  } else if (maintPctRav < 1.2) {
    assessment = 'UNDER-MAINTENANCE RISK (<1.2% RAV) — Potential deferred maintenance / assetsweating risk';
  }

  return {
    annualMaintenanceSpend: `$${maintCost.toLocaleString()}`,
    replacementAssetValue: `$${rav.toLocaleString()}`,
    maintenancePercentRav: `${maintPctRav.toFixed(2)}%`,
    projectedRemainingOpex: `$${projectedRemainingOpex.toLocaleString()}`,
    verdict: assessment,
    summary: [
      'ISO 55001 Pillar 3 — Financial & Life Cycle Cost (LCC) KPIs (Clause 6.2 & ISO 15663):',
      `- Annual Maintenance Spend: $${maintCost.toLocaleString()}`,
      `- Replacement Asset Value (RAV): $${rav.toLocaleString()}`,
      `- Maintenance Cost as % of RAV: ${maintPctRav.toFixed(2)}% [SMRP Benchmark: 1.5% - 3.0%]`,
      `- Projected ${rul}-Year Remaining Operational Spend (Opex): $${projectedRemainingOpex.toLocaleString()}`,
      `- Strategic Capex/Opex Verdict: ${assessment}`
    ].join('\n')
  };
}

/**
 * Pillar 4: MRO Inventory & Supply Chain (Clause 7.1)
 */
export function calculate_inventory_mro_kpis({
  total_stock_requests,
  stockout_incidents,
  annual_mro_issued_value_usd,
  average_inventory_valuation_usd,
  inactive_obsolete_stock_value_usd = 0,
}) {
  const requests = Number(total_stock_requests);
  const stockouts = Number(stockout_incidents);
  const issuedVal = Number(annual_mro_issued_value_usd);
  const avgVal = Number(average_inventory_valuation_usd);
  const deadVal = Number(inactive_obsolete_stock_value_usd);

  const serviceLevel = requests > 0 ? ((requests - stockouts) / requests) * 100 : 100;
  const stockoutRate = requests > 0 ? (stockouts / requests) * 100 : 0;
  const inventoryTurns = avgVal > 0 ? issuedVal / avgVal : 0;
  const deadStockPct = avgVal > 0 ? (deadVal / avgVal) * 100 : 0;

  return {
    storeroomServiceLevel: `${serviceLevel.toFixed(2)}%`,
    stockoutRate: `${stockoutRate.toFixed(2)}%`,
    inventoryTurnsRatio: Number(inventoryTurns.toFixed(2)),
    obsoleteStockRatio: `${deadStockPct.toFixed(1)}%`,
    summary: [
      'ISO 55001 Pillar 4 — MRO Inventory & Spares Readiness KPIs (Clause 7.1):',
      `- Storeroom Service Level: ${serviceLevel.toFixed(2)}% [Target: >=98.0%]`,
      `- Stockout Rate: ${stockoutRate.toFixed(2)}% [Target: <=2.0%]`,
      `- Inventory Turns Ratio: ${inventoryTurns.toFixed(2)} turns/year [Benchmark: 1.0 - 3.0 for MRO]`,
      `- Non-Moving / Obsolete Stock Ratio: ${deadStockPct.toFixed(1)}% [Target: <5.0%]`
    ].join('\n')
  };
}

/**
 * Pillar 5 & 6: Risk, QHSE & Master Data Governance (Clauses 6.1, 7.5, 10)
 */
export function calculate_data_risk_governance_kpis({
  safety_critical_pm_completed,
  safety_critical_pm_due,
  wo_closed_with_full_iso14224_codes,
  total_corrective_wo_closed,
  verified_assets_in_maximo,
  total_physical_assets_audited,
}) {
  const hseComp =
    Number(safety_critical_pm_due) > 0
      ? (Number(safety_critical_pm_completed) / Number(safety_critical_pm_due)) * 100
      : 100;

  const failureCodeComp =
    Number(total_corrective_wo_closed) > 0
      ? (Number(wo_closed_with_full_iso14224_codes) / Number(total_corrective_wo_closed)) * 100
      : 100;

  const registerAccuracy =
    Number(total_physical_assets_audited) > 0
      ? (Number(verified_assets_in_maximo) / Number(total_physical_assets_audited)) * 100
      : 100;

  const nonConformities = [];
  if (hseComp < 100) {
    nonConformities.push(
      `MAJOR NON-CONFORMITY (Clause 6.1): Safety/Statutory PM Compliance is ${hseComp.toFixed(1)}% (Mandatory 100%)`
    );
  }
  if (failureCodeComp < 95) {
    nonConformities.push(
      `MINOR NON-CONFORMITY (Clause 7.5 / ISO 14224): Failure Hierarchy Completeness is ${failureCodeComp.toFixed(1)}% (Target >=95%)`
    );
  }
  if (registerAccuracy < 98) {
    nonConformities.push(
      `OBSERVATION (Clause 7.5): Asset Register Accuracy is ${registerAccuracy.toFixed(1)}% (Target >=98%)`
    );
  }

  return {
    safetyPmCompliance: `${hseComp.toFixed(2)}%`,
    failureCodingCompleteness: `${failureCodeComp.toFixed(1)}%`,
    assetRegisterAccuracy: `${registerAccuracy.toFixed(1)}%`,
    verdict: nonConformities.length ? nonConformities.join(' | ') : 'FULLY COMPLIANT — Ready for ISO 55001 Certification Audit.',
    summary: [
      'ISO 55001 Pillar 5 & 6 — Risk, Statutory QHSE & Asset Data Governance (Clauses 6.1 & 7.5):',
      `- Safety-Critical / Statutory PM Compliance: ${hseComp.toFixed(2)}% [Mandatory Target: 100.0%]`,
      `- ISO 14224 Failure Coding Completeness (Problem-Cause-Remedy): ${failureCodeComp.toFixed(1)}% [Target: >=95.0%]`,
      `- Master Asset Register Verification Accuracy: ${registerAccuracy.toFixed(1)}% [Target: >=98.0%]`,
      `- ISO 55001 Audit Verdict: ${
        nonConformities.length ? nonConformities.join(' | ') : 'FULLY COMPLIANT — Ready for ISO 55001 Certification Audit.'
      }`
    ].join('\n')
  };
}

/**
 * Tier 1: IBM Maximo KPI Manager SQL Generator Tool (IBM Db2)
 */
export function generate_maximo_kpi_manager_sql({
  kpi_code,
  siteid = 'TEST',
  rolling_days = 30,
}) {
  const cleanSite = String(siteid).trim().toUpperCase();
  const days = Number(rolling_days) || 30;
  const hoursWindow = days * 24.0;
  const code = String(kpi_code).trim().toUpperCase();

  const templates = {
    MTTR: {
      kpinitname: 'ISO55K_MTTR_HRS',
      clause: 'ISO 55001 Clause 9.1 (Reliability)',
      format: 'DECIMAL',
      target: 4.0,
      caution_min: 6.0,
      alert_max: 8.0,
      sql: `SELECT COALESCE(AVG((DAYS(actfinish) - DAYS(actstart)) * 24.0 + (HOUR(actfinish) - HOUR(actstart)) + (MINUTE(actfinish) - MINUTE(actstart)) / 60.0), 0.0) FROM maximo.workorder WHERE siteid = '${cleanSite}' AND worktype IN ('CM', 'EM') AND status IN ('COMP', 'CLOSE') AND istask = 0 AND actstart IS NOT NULL AND actfinish IS NOT NULL AND actfinish >= CURRENT TIMESTAMP - ${days} DAYS`,
    },
    MTBF: {
      kpinitname: 'ISO55K_MTBF_HRS',
      clause: 'ISO 55001 Clause 9.1 (Reliability)',
      format: 'DECIMAL',
      target: 350.0,
      caution_min: 250.0,
      alert_max: 150.0,
      sql: `SELECT COALESCE((${hoursWindow} * COUNT(DISTINCT assetnum) - SUM(COALESCE(estdur, 0))) / NULLIF(COUNT(wonum), 0), ${hoursWindow}) FROM maximo.workorder WHERE siteid = '${cleanSite}' AND worktype = 'EM' AND status IN ('COMP', 'CLOSE') AND istask = 0 AND reportdate >= CURRENT TIMESTAMP - ${days} DAYS`,
    },
    PM_COMPLIANCE: {
      kpinitname: 'ISO55K_PM_COMP_PCT',
      clause: 'ISO 55001 Clause 8.1 (Operational Planning)',
      format: 'PERCENT',
      target: 95.0,
      caution_min: 90.0,
      alert_max: 85.0,
      sql: `SELECT COALESCE((CAST(SUM(CASE WHEN status IN ('COMP', 'CLOSE') AND actfinish <= targcompdate THEN 1 ELSE 0 END) AS DECIMAL(10,2)) / NULLIF(COUNT(wonum), 0)) * 100.0, 100.0) FROM maximo.workorder WHERE siteid = '${cleanSite}' AND worktype = 'PM' AND istask = 0 AND targcompdate BETWEEN CURRENT TIMESTAMP - ${days} DAYS AND CURRENT TIMESTAMP`,
    },
    PROACTIVE_RATIO: {
      kpinitname: 'ISO55K_PROACTIVE_PCT',
      clause: 'ISO 55001 Clause 8.1 (SMRP 80/20 Proactive Rule)',
      format: 'PERCENT',
      target: 80.0,
      caution_min: 75.0,
      alert_max: 65.0,
      sql: `SELECT COALESCE((SUM(CASE WHEN w.worktype IN ('PM', 'PDM', 'CM') THEN l.regularhrs ELSE 0 END) / NULLIF(SUM(l.regularhrs), 0)) * 100.0, 0.0) FROM maximo.labtrans l INNER JOIN maximo.workorder w ON l.refwo = w.wonum AND l.siteid = w.siteid WHERE w.siteid = '${cleanSite}' AND w.istask = 0 AND l.startdate >= CURRENT DATE - ${days} DAYS`,
    },
    MAINT_COST_RAV: {
      kpinitname: 'ISO55K_COST_RAV_PCT',
      clause: 'ISO 55001 Clause 6.2 & ISO 15663 (Life Cycle Cost)',
      format: 'PERCENT',
      target: 2.5,
      caution_min: 3.5,
      alert_max: 5.0,
      sql: `SELECT COALESCE((SUM(a.totcost) / NULLIF(SUM(a.replacecost), 0)) * 100.0, 0.0) FROM maximo.asset a WHERE a.siteid = '${cleanSite}' AND a.status IN ('OPERATING', 'ACTIVE') AND a.replacecost > 0`,
    },
    STOCKOUT_RATE: {
      kpinitname: 'ISO55K_WMATL_PCT',
      clause: 'ISO 55001 Clause 7.1 (MRO Resource Support)',
      format: 'PERCENT',
      target: 1.5,
      caution_min: 2.5,
      alert_max: 5.0,
      sql: `SELECT COALESCE((CAST(SUM(CASE WHEN status = 'WMATL' THEN 1 ELSE 0 END) AS DECIMAL(10,2)) / NULLIF(COUNT(wonum), 0)) * 100.0, 0.0) FROM maximo.workorder WHERE siteid = '${cleanSite}' AND status IN ('APPR', 'INPRG', 'WMATL', 'WPCOND') AND istask = 0`,
    },
    HSE_STATUTORY_PM: {
      kpinitname: 'ISO55K_HSE_PM_PCT',
      clause: 'ISO 55001 Clause 6.1 (Risk & Statutory Compliance)',
      format: 'PERCENT',
      target: 100.0,
      caution_min: 99.5,
      alert_max: 98.0,
      sql: `SELECT COALESCE((CAST(SUM(CASE WHEN status IN ('COMP', 'CLOSE') AND actfinish <= targcompdate THEN 1 ELSE 0 END) AS DECIMAL(10,2)) / NULLIF(COUNT(wonum), 0)) * 100.0, 100.0) FROM maximo.workorder WHERE siteid = '${cleanSite}' AND worktype = 'PM' AND wopriority = 1 AND istask = 0 AND targcompdate BETWEEN CURRENT TIMESTAMP - ${days} DAYS AND CURRENT TIMESTAMP`,
    },
    ISO14224_FAILURE_CODING: {
      kpinitname: 'ISO55K_FAILCODE_PCT',
      clause: 'ISO 55001 Clause 7.5 & ISO 14224 (Data Completeness)',
      format: 'PERCENT',
      target: 95.0,
      caution_min: 90.0,
      alert_max: 80.0,
      sql: `SELECT COALESCE((CAST(COUNT(DISTINCT fr_complete.wonum) AS DECIMAL(10,2)) / NULLIF(COUNT(DISTINCT w.wonum), 0)) * 100.0, 100.0) FROM maximo.workorder w LEFT JOIN (SELECT wonum, siteid FROM maximo.failurereport GROUP BY wonum, siteid HAVING COUNT(DISTINCT type) >= 3) fr_complete ON w.wonum = fr_complete.wonum AND w.siteid = fr_complete.siteid WHERE w.siteid = '${cleanSite}' AND w.worktype IN ('CM', 'EM') AND w.status IN ('COMP', 'CLOSE') AND w.istask = 0 AND w.actfinish >= CURRENT TIMESTAMP - ${days} DAYS`,
    },
  };

  const selected = templates[code];
  if (!selected) {
    return { error: `Unknown kpi_code '${code}'. Supported codes: ${Object.keys(templates).join(', ')}` };
  }

  return {
    kpiCode: code,
    kpiName: selected.kpinitname,
    isoClause: selected.clause,
    format: selected.format,
    target: selected.target,
    cautionMin: selected.caution_min,
    alertMax: selected.alert_max,
    db2Sql: selected.sql,
    summary: [
      `Maximo KPI Manager Definition — ${selected.kpinitname}:`,
      `- Clause: ${selected.clause}`,
      `- Format: ${selected.format} | Target: ${selected.target} | Warning: ${selected.caution_min} | Alert: ${selected.alert_max}`,
      `- Db2 SQL:`,
      `  ${selected.sql}`
    ].join('\n')
  };
}

/**
 * Tier 2: Gated ISO 55001 Corrective Action (CAPA) Proposal (Clause 10.1)
 */
export function propose_iso55001_capa_action({
  kpi_name,
  current_value,
  target_threshold,
  iso_clause_reference = '9.1',
  siteid = 'TEST',
  root_cause_summary,
  corrective_action_plan,
}) {
  const runId = crypto.randomUUID().slice(0, 8);
  const proposal = {
    run_id: runId,
    action: 'ISO55001_CAPA_AND_KPI_ACTION',
    kpi_name: String(kpi_name).trim(),
    current_value: String(current_value).trim(),
    target_threshold: String(target_threshold).trim(),
    iso_clause_reference: String(iso_clause_reference).trim(),
    siteid: String(siteid).trim().toUpperCase(),
    root_cause_summary: String(root_cause_summary).trim(),
    corrective_action_plan: String(corrective_action_plan).trim(),
    created_at: new Date().toISOString(),
    maximo_oslc_payload: {
      'spi:worktype': 'CAPA',
      'spi:siteid': String(siteid).trim().toUpperCase(),
      'spi:description': `ISO 55001 Clause ${iso_clause_reference} Breach: ${kpi_name} (${current_value} vs ${target_threshold})`,
      'spi:description_longdescription': `Root Cause: ${root_cause_summary}\nCorrective Action: ${corrective_action_plan}`,
      'spi:wopriority': 1,
    },
  };

  KPI_PENDING_PROPOSALS.set(runId, proposal);

  return {
    requiresApproval: true,
    run_id: runId,
    proposal,
    message: `APPROVAL_REQUIRED run_id=${runId} — ISO 55001 Clause ${iso_clause_reference} Corrective Action (CAPA) for '${kpi_name}' (Site: ${proposal.siteid}) is parked for Asset Manager approval.`
  };
}
