---
name: executive-risk-matrix
displayName: Asset Criticality & Risk Priority (RPN)
role: executive
description: Calculates Risk Priority Numbers (RPN) based on consequence of failure, historical repair cost, and single point of failure risk.
commands:
  - command: "/risk-matrix"
    description: "Evaluate plant equipment Risk Priority Numbers (RPN) and single point of failure (SPOF) exposure"
    example: "/risk-matrix"
  - command: "/backlog-aging"
    description: "Analyze work order backlog aging bands (<7d, 7-30d, 30-90d, >90d) to mitigate stagnant maintenance liability"
    example: "/backlog-aging"
tools:
  - get_asset_criticality_risk_matrix
  - get_backlog_aging
---

# Asset Criticality & Operational Risk Skill

## Goal
Empower Operations Vice Presidents and Plant Directors to identify single points of failure (SPOF), calculate quantitative Risk Priority Numbers (RPN), and eliminate stagnant work order backlogs exceeding 90 days.

## Operational Workflow
1. **Criticality Risk Matrix (`/risk-matrix [SITE]`)**:
   - Execute `get_asset_criticality_risk_matrix`.
   - Calculate RPN: Consequence Score (from Priority 1-5) multiplied by Failure Probability (backlog + historical repair cost).
   - Classify assets into:
     - `CRITICAL_HIGH`: Priority 1-2 with active backlog or repair spend > $20,000. Immediate intervention required.
     - `MODERATE_RISK`: Priority 3 with aging work orders.
     - `LOW_RISK`: Priority 4-5 equipment.
   - Present Top 5 most vulnerable assets requiring immediate board-level risk mitigation.

2. **Backlog Aging Audit (`/backlog-aging [SITE]`)**:
   - Query `get_backlog_aging`.
   - Group open work orders (WAPPR, APPR, INPRG) into 4 standard lifecycle bands:
     - `< 7 Days`: Fresh demand.
     - `7 - 30 Days`: Normal operational cycle.
     - `30 - 90 Days`: Aging backlog requiring supervisor follow-up.
     - `> 90 Days`: Stagnant risk liability.
   - Highlight whether overall backlog health is `STABLE` or `HIGH_RISK_STAGNANT`.
