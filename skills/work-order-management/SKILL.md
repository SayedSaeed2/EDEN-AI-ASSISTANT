---
name: work-order-management
displayName: Work Order Operations & Execution
role: technician
description: Real-time query, tracking, filtering, and reporting of IBM Maximo Work Orders across facilities, sites, and time periods with Arabic support.
commands:
  - command: "/work-orders"
    description: "Query and list Work Orders filtered by site, status (WAPPR, APPR, INPRG, COMP, CLOSE), period (7d, 30d, 90d, 365d, all), and limit"
    example: "/work-orders site=REGALH-G1 period=90d limit=50"
  - command: "/unplanned-orders"
    description: "Query unplanned corrective (CM) and emergency (EM) work orders by site and period"
    example: "/unplanned-orders site=REGALH-G1 period=30d limit=25"
  - command: "/create-wo"
    description: "Create a new corrective work order in IBM Maximo"
    example: "/create-wo asset=ASSET124 site=REGALH-G1 desc='Pump mechanical seal failure' dept=MECH"
tools:
  - get_maximo_work_orders
  - get_unplanned_work_orders
  - get_work_order_site_summary
  - get_work_order_count
  - create_maximo_work_order
  - update_maximo_work_order_status
---

# Work Order Operations & Execution Skill

## Overview
Comprehensive operational command skill for facility supervisors, maintenance engineers, and technical planners to query, track, and analyze IBM Maximo Work Orders (Corrective CM, Preventive PM, Emergency EM) across Eden sites.

## Core Capabilities
1. **List Work Orders (`/work-orders [site=<SITE>] [status=<STATUS>] [period=<PERIOD>] [limit=<N>]`)**:
   - Queries Maximo `/MXWO` object structure in real time.
   - Decodes legacy visual Arabic presentation forms (`arabicCleaner`) so Arabic descriptions appear in correct natural order.
   - Formats results into structured responsive markdown table with instant export actions (CSV, Excel, PDF with Amiri Arabic font).

2. **Unplanned Work Orders (`/unplanned-orders [site=<SITE>] [period=<PERIOD>] [limit=<N>]`)**:
   - Isolates unscheduled maintenance incidents (work types `CM` and `EM`).
   - Filters out child tasks (`T-*`) to show clean parent work orders.

3. **Status Transitions & Dispatch**:
   - Update statuses (`APPR`, `INPRG`, `COMP`, `CLOSE`).
