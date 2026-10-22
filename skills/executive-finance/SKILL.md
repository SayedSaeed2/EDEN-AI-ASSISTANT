---
name: executive-finance
displayName: OPEX Budget & Spend Variance Control
role: executive
description: Monitors maintenance OPEX financial health, labor vs materials allocation, and dollar variance across departments.
commands:
  - command: "/budget-variance"
    description: "Analyze actual OPEX maintenance expenditure against allocated budgets and dollar variances"
    example: "/budget-variance"
  - command: "/cost-summary"
    description: "Detailed financial breakdown across Labor, Materials, Services/Contractors, and Tools"
    example: "/cost-summary"
  - command: "/roi"
    description: "Calculate executive ROI & maintenance cost avoidance scorecard (catastrophic failures, self-execution savings, energy)"
    example: "/roi"
tools:
  - get_budget_variance_analysis
  - get_executive_cost_summary
  - get_executive_roi_cost_avoidance
---

# Executive Financial Governance & Cost Variance Skill

## Goal
Enable Chief Financial Officers (CFOs), Asset Directors, and Executive Facility Managers to audit operational expenditure (OPEX) in real-time, detect cost overruns before fiscal close, and reallocate budget between departments.

## Operational Workflow
1. **Budget Variance (`/budget-variance [SITE]`)**:
   - Query `get_budget_variance_analysis` for the active or specified site.
   - Contrast actual maintenance spend against estimated budgets.
   - Categorize variance by department (e.g. MECH, ELEC, CIVIL, HVAC).
   - Flag fiscal health status (`ON_TRACK` vs `OVER_BUDGET`).

2. **Cost Breakdown Analysis (`/cost-summary [SITE]`)**:
   - Query `get_executive_cost_summary`.
   - Break down spend into Labor (internal payroll), Materials (storeroom issues), Services (external contractors), and Tools.
   - Identify disproportionate contractor reliance or spike in emergency material costs.
