---
name: executive-capex
displayName: CAPEX & Portfolio Replacement Advisory
role: executive
description: Evaluates whole-life asset spend vs replacement costs, benchmarks reliability across sites, and produces C-Suite audit memos.
commands:
  - command: "/capex"
    description: "Evaluate Repair-to-Replacement ratio, MTTR, and capital renewal recommendation for an asset"
    example: "/capex ASSET124"
  - command: "/board-memo"
    description: "Generate a C-Suite executive briefing on maintenance budget, variances, and asset risks"
    example: "/board-memo"
  - command: "/league"
    description: "Benchmark all operational facilities in the Cross-Site Reliability League"
    example: "/league"
tools:
  - get_machine_card
  - get_asset_lifecycle_forecast
  - get_budget_variance_analysis
  - get_multi_site_reliability_league
  - generate_executive_audit_brief
---

# Executive CAPEX & Portfolio Replacement Skill

## Goal
Guide executive decision makers (Chief Operating Officers, Asset Directors, CFOs) with clear financial forecasts, lifecycle risk assessments, and multi-site reliability league comparisons.

## Workflow Execution Steps
1. **Asset Lifecycle & CAPEX Analysis (`/capex <assetnum>`)**:
   - Query `get_machine_card` for the target asset.
   - Extract Purchase Price, Total Maintenance Spend, and Repair-to-Replacement Ratio.
   - Consult `search_knowledge_base` with "Whole life asset cost replacement threshold" to align with ISO 55000 standards.
   - Deliver an executive conclusion: CONTINUE_OPERATION, SCHEDULE_OVERHAUL, or CAPEX_REPLACEMENT_DUE.

2. **C-Suite Audit Briefing (`/board-memo`)**:
   - Query `generate_executive_audit_brief` and `get_budget_variance_analysis`.
   - Synthesize operational spending against industry benchmarks.
   - Highlight high-cost assets (Money Pits) requiring board review.

3. **Multi-Site League (`/league`)**:
   - Call `get_multi_site_reliability_league` with all_sites.
   - Present the ranking table with PM Compliance, CM Ratio, and MTTR.
