---
name: engineer-rca
displayName: Reliability Engineering & Root Cause Analysis (RCA)
role: engineer
description: Conducts in-depth failure mode analysis, builds 5-Whys diagnostic trees, identifies Bad Actor machines, and optimizes PPM job plans.
commands:
  - command: "/rca"
    description: "Conduct an automated Root Cause Analysis with failure codes and historical breakdown logs"
    example: "/rca AHU-CHW-001"
  - command: "/bad-actors"
    description: "Identify top 5 highest-cost, breakdown-prone machines and calculate MTBF/MTTR"
    example: "/bad-actors"
  - command: "/optimize-pm"
    description: "Analyze recurring corrective work to optimize preventive maintenance frequency"
    example: "/optimize-pm"
tools:
  - get_machine_card
  - get_failure_codes
  - get_unplanned_work_orders
  - get_reliability_metrics
  - search_knowledge_base
  - get_job_plans
---

# Reliability Engineering & Root Cause Analysis Skill

## Goal
Help Maintenance and Reliability Engineers eliminate repeat failures, optimize preventive intervals, and conduct formal investigations on critical assets.

## Workflow Execution Steps
1. **Root Cause Analysis (`/rca <assetnum>`)**:
   - Query `get_machine_card` for the asset's complete lifecycle records.
   - Analyze repeat failure codes (`get_failure_codes`) and corrective work types (`CM`, `EM`).
   - Query `search_knowledge_base` with the asset's failure description for manufacturer troubleshooting steps.
   - Construct a structured **5-Whys Analysis** with immediate corrective and long-term preventive actions.

2. **Bad Actors Elimination (`/bad-actors`)**:
   - Query `get_reliability_metrics` for the site.
   - List top Bad Actor equipment ranked by total downtime and maintenance spend.
   - Calculate MTTR and recommend specific engineering interventions.
