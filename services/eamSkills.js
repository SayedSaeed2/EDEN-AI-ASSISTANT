/**
 * services/eamSkills.js
 * Enterprise Asset Management (EAM), ISO 55001 Governance,
 * ISO 14224 Failure Coding, and Reliability Engineering (MTBF/MTTR/Availability).
 *
 * Adapted from nodejs_eam_skills_maximoEamSkills.js
 */

import crypto from 'node:crypto';

// In-memory store for Human-In-The-Loop (HITL) proposal records
export const PENDING_PROPOSALS = new Map();

/**
 * 1. Calculate Reliability KPIs (MTBF, MTTR, Availability, Failure Rate)
 */
export function calculate_reliability_kpis({
  total_operating_hours,
  total_downtime_hours,
  number_of_failures,
}) {
  const opHours = Number(total_operating_hours);
  const downHours = Number(total_downtime_hours);
  const failures = Number(number_of_failures);

  if (isNaN(opHours) || isNaN(downHours) || isNaN(failures) || opHours < 0 || downHours < 0) {
    return { error: 'Operating and downtime hours must be non-negative numbers.' };
  }

  if (failures <= 0) {
    return {
      totalOperatingHours: opHours,
      totalDowntimeHours: downHours,
      failuresRecorded: 0,
      mtbf: 'Infinite (No Failures)',
      mttr: '0.00 hours',
      availability: '100.00%',
      failureRate: '0.00000 failures/hour',
      summary: `Zero failures recorded over ${opHours} hrs. Inherent Availability = 100.00%. MTBF is infinite for this observation window.`
    };
  }

  const mtbf = opHours / failures;
  const mttr = downHours / failures;
  const availability = mtbf + mttr > 0 ? (mtbf / (mtbf + mttr)) * 100 : 0;
  const failureRate = mtbf > 0 ? 1 / mtbf : 0;

  return {
    totalOperatingHours: opHours,
    totalDowntimeHours: downHours,
    failuresRecorded: failures,
    mtbfHours: Number(mtbf.toFixed(2)),
    mttrHours: Number(mttr.toFixed(2)),
    inherentAvailability: `${availability.toFixed(2)}%`,
    failureRatePerHour: Number(failureRate.toFixed(5)),
    summary: [
      `Reliability Metrics Summary (ISO 14224 / SMRP):`,
      `- MTBF (Mean Time Between Failures): ${mtbf.toFixed(2)} hours`,
      `- MTTR (Mean Time To Repair): ${mttr.toFixed(2)} hours`,
      `- Inherent Availability: ${availability.toFixed(2)}%`,
      `- Failure Rate (λ): ${failureRate.toFixed(5)} failures/hour`
    ].join('\n')
  };
}

/**
 * 2. Evaluate ISO 55001 Asset Criticality & RCM Strategy Tier
 */
export function evaluate_asset_criticality({
  asset_num = 'ASSET',
  safety_impact = 3,
  environmental_impact = 2,
  production_impact = 3,
  mttr_severity = 2,
  failure_frequency = 2,
}) {
  const s = Math.min(5, Math.max(1, Number(safety_impact) || 3));
  const e = Math.min(5, Math.max(1, Number(environmental_impact) || 2));
  const p = Math.min(5, Math.max(1, Number(production_impact) || 3));
  const m = Math.min(5, Math.max(1, Number(mttr_severity) || 2));
  const f = Math.min(5, Math.max(1, Number(failure_frequency) || 2));

  const consequence = Math.max(s, e) * 2 + p + m;
  const rpnScore = consequence * f;

  let tier = 'CLASS C (Non-Critical)';
  let strategy = 'Run-to-Failure (RTF) or Basic Routine Inspection.';

  if (rpnScore >= 45 || s === 5) {
    tier = 'CLASS A (Critical)';
    strategy = 'Condition-Based Monitoring (CBM/IoT), Predictive Maintenance (PdM), Critical Spares Stocked On-Site.';
  } else if (rpnScore >= 22) {
    tier = 'CLASS B (Essential)';
    strategy = 'Time/Meter-Based Preventive Maintenance (PM), Standard Failure Hierarchy Tracking.';
  }

  return {
    assetnum: asset_num,
    consequenceIndex: consequence,
    failureFrequency: f,
    rpnScore,
    classificationTier: tier,
    recommendedStrategy: strategy,
    summary: [
      `Asset Criticality Assessment [${asset_num}]:`,
      `- Consequence Index: ${consequence} | Frequency: ${f}`,
      `- Total Criticality Score (RPN): ${rpnScore}`,
      `- Classification: ${tier}`,
      `- Recommended ISO 55001 Strategy: ${strategy}`
    ].join('\n')
  };
}

/**
 * 3. Validate ISO 14224 3-Level Failure Hierarchy (Problem -> Cause -> Remedy)
 */
export function validate_failure_hierarchy({
  wonum = 'WO',
  failure_class = '',
  problem_code = '',
  cause_code = '',
  remedy_code = '',
}) {
  const invalidValues = new Set(['', 'NONE', 'N/A', 'TBD', 'UNKNOWN', 'NULL', 'UNDEFINED']);
  const checks = [
    ['Failure Class', failure_class],
    ['Problem Code', problem_code],
    ['Cause Code', cause_code],
    ['Remedy Code', remedy_code],
  ];

  const missing = checks
    .filter(([, val]) => !val || invalidValues.has(String(val).trim().toUpperCase()))
    .map(([label]) => label);

  if (missing.length > 0) {
    return {
      compliant: false,
      wonum,
      missingFields: missing,
      error: `VALIDATION FAILED for Work Order ${wonum}: Missing or generic failure codes: ${missing.join(', ')}. Policy requires complete Problem -> Cause -> Remedy before status COMP.`
    };
  }

  return {
    compliant: true,
    wonum,
    hierarchy: `${String(failure_class).toUpperCase()} -> ${String(problem_code).toUpperCase()} -> ${String(cause_code).toUpperCase()} -> ${String(remedy_code).toUpperCase()}`,
    message: `VALIDATION PASSED for Work Order ${wonum}: Hierarchy is fully compliant with ISO 14224 reliability reporting standards.`
  };
}

/**
 * 4. Build Maximo OSLC REST API Query
 */
export function build_maximo_oslc_query({
  object_structure = 'mxapiwodetail',
  where_clause = '',
  select_fields = 'wonum,description,status,assetnum,location,targstartdate',
  page_size = 20,
}) {
  const cleanOs = String(object_structure).trim().toLowerCase();
  const params = new URLSearchParams({
    lean: '1',
    'oslc.select': String(select_fields).trim(),
    'oslc.where': String(where_clause).trim(),
    'oslc.pageSize': String(page_size),
  });

  const endpoint = `/maximo/api/os/${cleanOs}?${params.toString()}`;

  return {
    objectStructure: cleanOs.toUpperCase(),
    endpoint,
    headers: {
      apikey: '<MAXIMO_API_KEY>',
      Accept: 'application/json'
    },
    sampleCurl: `curl -X GET "https://<MAXIMO_HOST>${endpoint}" -H "apikey: $API_KEY" -H "Accept: application/json"`
  };
}

/**
 * 5. Propose PM Frequency Update (Tier 2 Gated Proposal)
 */
export function propose_pm_frequency_update({
  pmnum,
  siteid = 'TEST',
  current_frequency,
  proposed_frequency,
  frequnit = 'DAYS',
  engineering_justification = '',
}) {
  const runId = crypto.randomUUID().slice(0, 8);
  const unitUpper = String(frequnit).trim().toUpperCase();

  const proposal = {
    run_id: runId,
    action: 'MAXIMO_PM_FREQUENCY_UPDATE',
    pmnum: String(pmnum).trim().toUpperCase(),
    siteid: String(siteid).trim().toUpperCase(),
    current_frequency: Number(current_frequency),
    proposed_frequency: Number(proposed_frequency),
    frequnit: unitUpper,
    justification: String(engineering_justification).trim(),
    created_at: new Date().toISOString(),
    oslc_payload: {
      'spi:frequency': Number(proposed_frequency),
      'spi:frequnit': unitUpper,
    },
  };

  PENDING_PROPOSALS.set(runId, proposal);

  return {
    requiresApproval: true,
    run_id: runId,
    proposal,
    message: `APPROVAL_REQUIRED run_id=${runId} — PM '${proposal.pmnum}' frequency change (${proposal.current_frequency} -> ${proposal.proposed_frequency} ${unitUpper}) is parked for Reliability Engineer sign-off.`
  };
}
