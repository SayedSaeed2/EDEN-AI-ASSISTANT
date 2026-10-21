/**
 * services/fmeaRcmService.js
 * RCM, FMEA/FMECA, ISO 14224 Failure Mode Modeling, and Maximo Integration.
 * Adapted from fmea_rcm_skill_fmeaRcmSkills.js
 */

import crypto from 'node:crypto';

// Shared in-memory store for Tier-2 FMEA / Job Plan proposals
export const FMEA_PENDING_PROPOSALS = new Map();

/**
 * 1. Calculate FMEA Risk Priority Number (RPN) & Criticality
 */
export function calculate_fmea_rpn({
  failure_mode_name,
  severity_s,
  occurrence_o,
  detectability_d,
  safety_or_environmental_flag = false,
}) {
  const S = Number(severity_s);
  const O = Number(occurrence_o);
  const D = Number(detectability_d);

  if (isNaN(S) || isNaN(O) || isNaN(D) || S < 1 || S > 10 || O < 1 || O > 10 || D < 1 || D > 10) {
    return { error: 'Severity, Occurrence, and Detectability ratings must be integers between 1 and 10.' };
  }

  const rpn = S * O * D;

  let riskLevel = 'LOW RISK (Monitor)';
  let recommendedAction = 'Routine preventive maintenance or run-to-failure.';

  if (Boolean(safety_or_environmental_flag) || S >= 9) {
    riskLevel = 'CRITICAL / SAFETY HAZARD (Immediate Mitigation Required)';
    recommendedAction = 'Mandatory engineering redesign, safety interlock, or continuous CBM/IoT monitoring.';
  } else if (rpn >= 100) {
    riskLevel = 'HIGH RISK (Action Required)';
    recommendedAction = 'Redesign maintenance task frequency, add condition monitoring (P-F interval), or upgrade component specs.';
  } else if (rpn >= 40) {
    riskLevel = 'MEDIUM RISK (Evaluate)';
    recommendedAction = 'Optimize existing Preventive Maintenance (PM) job plan or tighten inspection intervals.';
  }

  return {
    failureMode: failure_mode_name,
    severity: S,
    occurrence: O,
    detectability: D,
    rpnScore: rpn,
    safetyFlag: Boolean(safety_or_environmental_flag),
    riskClassification: riskLevel,
    recommendedStrategy: recommendedAction,
    summary: [
      `FMEA Risk Analysis for Failure Mode: '${failure_mode_name}'`,
      `- Severity (S): ${S}/10 | Occurrence (O): ${O}/10 | Detectability (D): ${D}/10`,
      `- Calculated RPN (Risk Priority Number): ${rpn} [Scale: 1 - 1000]`,
      `- Safety / Environmental Flag: ${safety_or_environmental_flag ? 'YES (High Priority)' : 'No'}`,
      `- Risk Classification: ${riskLevel}`,
      `- Recommended Reliability Strategy: ${recommendedAction}`
    ].join('\n')
  };
}

/**
 * 2. ISO 14224 Failure Hierarchy Builder for Maximo
 */
export function build_iso14224_failure_hierarchy({
  equipment_class,
  component_name,
  problem_symptom,
  failure_cause,
  corrective_remedy,
}) {
  const cls = String(equipment_class || 'EQUIP').trim().toUpperCase();
  const comp = String(component_name || 'COMP').trim().toUpperCase();
  const prob = String(problem_symptom || 'SYMPTOM').trim().toUpperCase();
  const cause = String(failure_cause || 'CAUSE').trim().toUpperCase();
  const remedy = String(corrective_remedy || 'REMEDY').trim().toUpperCase();

  return {
    equipmentClass: cls,
    componentName: comp,
    problemSymptom: prob,
    failureCause: cause,
    correctiveRemedy: remedy,
    summary: [
      `ISO 14224 Failure Hierarchy Mapping for Maximo [Class: ${cls}]:`,
      `1. Failure Class: ${cls}`,
      `2. Component / Assembly: ${comp}`,
      `3. Problem Code (Symptom): ${prob} -> Maps to Maximo PROBLEM domain`,
      `4. Cause Code (Root Failure Mode): ${cause} -> Maps to Maximo CAUSE domain`,
      `5. Remedy Code (Corrective Action): ${remedy} -> Maps to Maximo REMEDY domain`,
      `Maximo Configuration Advice: Create a dedicated Failure Class '${cls}' linked to Failure List entries for '${comp}' with problem code '${prob}', cause '${cause}', and remedy '${remedy}'.`
    ].join('\n')
  };
}

/**
 * 3. SAE JA1011 RCM Decision Logic Engine
 */
export function generate_rcm_decision_logic({
  failure_mode_description,
  hidden_failure_hazard = false,
  safety_environmental_consequence = false,
  operational_economic_consequence = false,
  technically_feasible_cbm = false,
  technically_feasible_time_based_pm = false,
}) {
  let strategy = '';
  let justification = '';

  if (Boolean(safety_environmental_consequence) || Boolean(hidden_failure_hazard)) {
    if (Boolean(technically_feasible_cbm)) {
      strategy = 'Condition-Based Monitoring (CBM / Predictive Maintenance)';
      justification = 'Safety/Environment consequence requires proactive failure detection prior to functional failure using P-F interval monitoring.';
    } else if (Boolean(technically_feasible_time_based_pm)) {
      strategy = 'Scheduled Discard or Restoration (Time/Meter-Based PM)';
      justification = 'Safety consequence present, but CBM is not feasible. Scheduled overhaul/replacement before wear-out age.';
    } else {
      strategy = 'Mandatory Redesign / Engineering Modification';
      justification = 'Safety/Environmental consequence with NO proactive maintenance task technically feasible. Default to redesign to eliminate hazard.';
    }
  } else if (Boolean(operational_economic_consequence)) {
    if (Boolean(technically_feasible_cbm)) {
      strategy = 'Condition-Based Monitoring (CBM / PdM)';
      justification = 'Economic consequence justifies condition monitoring cost based on total cost of ownership (TCO).';
    } else if (Boolean(technically_feasible_time_based_pm)) {
      strategy = 'Scheduled Preventive Maintenance (PM / Inspection)';
      justification = 'Economic consequence managed effectively via scheduled time/meter-based servicing.';
    } else {
      strategy = 'Run-to-Failure (RTF) with Corrective Redundancy or Quick Spares';
      justification = 'Proactive task is not technically feasible or cost-effective. Run to failure and hold critical spare on-site.';
    }
  } else {
    strategy = 'Run-to-Failure (RTF / Corrective Maintenance)';
    justification = 'No hidden hazard, safety, environmental, or significant economic consequence. Non-critical failure mode.';
  }

  return {
    failureMode: failure_mode_description,
    hiddenHazard: Boolean(hidden_failure_hazard),
    safetyEnvironmental: Boolean(safety_environmental_consequence),
    operationalEconomic: Boolean(operational_economic_consequence),
    selectedStrategy: strategy,
    engineeringJustification: justification,
    summary: [
      `SAE JA1011 RCM Decision Tree Evaluation:`,
      `- Failure Mode: '${failure_mode_description}'`,
      `- Hidden Hazard: ${hidden_failure_hazard} | Safety/Env: ${safety_environmental_consequence} | Economic: ${operational_economic_consequence}`,
      `- Selected Reliability Strategy: ${strategy}`,
      `- Engineering Justification: ${justification}`
    ].join('\n')
  };
}

/**
 * 4. Tier-2 Gated FMEA Job Plan / PM Update Proposal
 */
export function propose_fmea_jobplan_update({
  jobplan_num,
  siteid = 'TEST',
  failure_mode_addressed,
  proposed_task_change,
  rpn_reduction_expected = 0,
  rcm_justification,
}) {
  const runId = crypto.randomUUID().slice(0, 8);
  const proposal = {
    run_id: runId,
    action: 'FMEA_JOBPLAN_UPDATE',
    jobplan_num: String(jobplan_num).trim().toUpperCase(),
    siteid: String(siteid).trim().toUpperCase(),
    failure_mode: String(failure_mode_addressed).trim(),
    task_change: String(proposed_task_change).trim(),
    rpn_reduction: Number(rpn_reduction_expected),
    justification: String(rcm_justification).trim(),
    created_at: new Date().toISOString(),
    maximo_oslc_payload: {
      'spi:jpnum': String(jobplan_num).trim().toUpperCase(),
      'spi:siteid': String(siteid).trim().toUpperCase(),
      'spi:description': `FMEA Optimized: Add task for failure mode '${failure_mode_addressed}'`,
      'spi:np_justification': String(rcm_justification).trim(),
    },
  };

  FMEA_PENDING_PROPOSALS.set(runId, proposal);

  return {
    requiresApproval: true,
    run_id: runId,
    proposal,
    message: `APPROVAL_REQUIRED run_id=${runId} — FMEA Job Plan update for '${proposal.jobplan_num}' (Site: ${proposal.siteid}) addressing failure mode '${proposal.failure_mode}' is parked for Reliability Manager approval.`
  };
}
