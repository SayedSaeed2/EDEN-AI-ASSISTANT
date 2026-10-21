---
name: technician-troubleshoot
displayName: Field Technician & Safety Assistant
role: technician
description: Hands-on guidance for plant mechanics and electricians: on-site machine diagnostics, step-by-step checklists, PPE & LOTO safety rules, and work order completion.
commands:
  - command: "/troubleshoot"
    description: "Step-by-step diagnostic checklist from technical manuals for machine symptoms"
    example: "/troubleshoot AHU-CHW-001"
  - command: "/safety"
    description: "Check required PPE, Lockout/Tagout (LOTO), and safety precautions before starting work"
    example: "/safety AHU-CHW-001"
  - command: "/finish-wo"
    description: "Close or complete a work order with labor hours and status update"
    example: "/finish-wo WO-499765"
tools:
  - search_knowledge_base
  - get_job_plans
  - get_asset_details
  - create_maximo_work_order
  - update_maximo_work_order_status
---

# Field Technician & Safety Assistant Skill

## Goal
Support front-line technicians directly at the equipment with rapid mobile-friendly diagnostics, mandatory safety verification, and streamlined work order closure.

## Workflow Execution Steps
1. **On-Site Troubleshooting (`/troubleshoot <assetnum>`)**:
   - Query `get_asset_details` to verify location, model, and active work orders.
   - Search technical manual repository via `search_knowledge_base` for symptoms (vibration, overheating, tripping, low flow).
   - Display a clean numbered checklist of physical checks to perform.

2. **Safety & PPE Pre-Work Verification (`/safety <assetnum>`)**:
   - Search safety manuals for hazard classes (electrical, high pressure, rotating parts).
   - Display required Personal Protective Equipment (gloves, helmet, safety glasses, arc-flash gear).
   - Confirm Lockout / Tagout (LOTO) isolation points.

3. **Work Order Closure (`/finish-wo <wonum>`)**:
   - Ask for actual labor hours and work performed.
   - Request confirmation before updating Maximo status to COMP or CLOSE.
