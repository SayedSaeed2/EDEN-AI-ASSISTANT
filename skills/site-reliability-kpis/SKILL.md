---
name: site-reliability-kpis
displayName: Site Reliability & Maintenance KPIs (CM, PM, Backlog, MTTR, MTBF)
role: executive
description: Calculate and monitor vital maintenance & reliability KPIs (Corrective Maintenance Ratio, PM Compliance %, Active Backlog, Mean Time to Repair, Mean Time Between Failures, and Inherent Availability) for any Maximo site over specific time horizons (7d, 30d, 90d, 180d, 365d, all).
commands:
  - command: "/site-kpis"
    description: "Generate comprehensive Site Maintenance & Reliability KPI Scorecard (CM Ratio, PM Compliance %, Active Backlog, MTTR, MTBF, and Availability %)"
    example: "/site-kpis site=REGALH-G1 period=90d"
  - command: "/cm-ratio"
    description: "Evaluate Corrective Maintenance (CM) ratio against world-class benchmark (< 20%)"
    example: "/cm-ratio site=REGALH-G1 period=30d"
  - command: "/cm-to-pm"
    description: "Calculate direct CM to PM Ratio & multiplier (e.g. 1:4 or 0.25x) for a site and period"
    example: "/cm-to-pm site=REGALH-G1 period=30d"
  - command: "/pm-compliance"
    description: "Evaluate Preventive Maintenance (PM) on-time completion compliance (Target >= 90%)"
    example: "/pm-compliance site=REGALH-G1 period=30d"
  - command: "/site-mtbf"
    description: "Calculate Mean Time Between Failures (MTBF) and Inherent Equipment Availability for a site"
    example: "/site-mtbf site=REGALH-G1 period=365d"
  - command: "/site-backlog"
    description: "Inspect active work order backlog volume and approval distribution for a site"
    example: "/site-backlog site=REGALH-G1"
tools:
  - get_site_kpi_scorecard
  - get_multi_site_reliability_league
  - get_reliability_metrics
  - calculate_reliability_availability_kpis
  - calculate_work_management_kpis
---

# Site Maintenance & Reliability KPI Governance Skill

## 1. Objective & Scope
This skill provides real-time, audit-grade KPI scorecards for facility and maintenance operations across any IBM Maximo site for user-specified periods (7 days, 30 days, 90 days, 180 days, 1 year, or historical all-time).

### Key Metrics Covered:
1. **CM Ratio (Corrective Maintenance %):**
   $$\text{CM Ratio} = \frac{\text{Total CM + EM Work Orders}}{\text{Total Work Orders in Period}} \times 100$$
   - *Target:* $< 20.0\%$ (World Class per SMRP & ISO 55001).

2. **PM Compliance (% On-Time):**
   $$\text{PM Compliance} = \frac{\text{PM Work Orders Completed on or before Target Finish}}{\text{Total Scheduled PM Work Orders in Period}} \times 100$$
   - *Target:* $\ge 90.0\%$ (SMRP Pillar 3 Standard).

3. **Active Backlog (Open Work Orders):**
   - Counts all open work orders in statuses `WAPPR`, `APPR`, `INPRG`, `WSCH`, and `WMATL`.
   - *Target:* $< 20$ open work orders per facility section.

4. **MTTR (Mean Time to Repair):**
   $$\text{MTTR} = \frac{\text{Total Unplanned Downtime or Repair Hours}}{\text{Number of Corrective Breakdowns}}$$
   - *Target:* $< 3.5\text{ hours}$ (Rapid restoration).

5. **MTBF (Mean Time Between Failures):**
   $$\text{MTBF} = \frac{\text{Operating Hours} - \text{Total Downtime Hours}}{\text{Number of Failures}}$$
   - *Standard:* Maximized operational uptime between breakdown events.

6. **Inherent Availability ($A_i$):**
   $$A_i = \frac{\text{MTBF}}{\text{MTBF} + \text{MTTR}} \times 100$$
   - *Target:* $\ge 99.5\%$ for critical utilities.

---

## 2. Operational Workflows & Commands

### Command: `/site-kpis`
- **Purpose**: Generates the complete executive and engineering scorecard for a specific facility site.
- **Parameters**:
  - `site` (optional): Site ID (e.g. `REGALH-G1`, `TEST`, `CRYSTAL`, `VIPCH`). Defaults to active working context.
  - `period` (optional): `7d` (Week), `30d` (Month, default), `90d` (Quarter), `180d` (6 Months), `365d` (1 Year), `all` (All-time history).
- **Tool Executed**: `get_site_kpi_scorecard`.

### Command: `/cm-ratio`
- **Purpose**: Quick check of reactive vs proactive maintenance workload.
- **Tool Executed**: `get_site_kpi_scorecard` or `get_reliability_metrics`.

### Command: `/pm-compliance`
- **Purpose**: Evaluates PM adherence and backlog risk before regulatory inspection.
- **Tool Executed**: `get_site_kpi_scorecard`.

### Command: `/site-mtbf`
- **Purpose**: Reliability engineering uptime and MTBF analysis.
- **Tool Executed**: `get_site_kpi_scorecard`.

### Command: `/site-backlog`
- **Purpose**: Work order aging and active backlog bottleneck identification.
- **Tool Executed**: `get_site_kpi_scorecard`.
