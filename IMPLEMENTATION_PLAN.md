# Implementation Plan

## Goal

Use the selected topology name and user-selected timeframe to list, in one flow:

- Incidents
- CHG (CM)
- Manual deployments
- Dispatcher modifications

## 1. Inputs and Contract

- UI inputs:
  - `topology`
  - `timeframeType`: `minutes | hours | days`
  - `timeframeValue`: positive integer
- Backend-normalized contract:
  - `topology: string`
  - `window: { type, value }`
  - `startTs`, `endTs` (computed server-side)
- Validation:
  - topology required
  - timeframe value > 0
  - guard rails for max window

## 2. Unified Response Schema

Return one payload containing:

- `incidents[]`
- `changes_cm[]`
- `manual_deployments[]`
- `dispatcher_modifications[]`
- `summary` counters per category
- `metadata` (`topology`, `startTs`, `endTs`, duration, source status)

## 3. Backend Orchestration

- Add one orchestrator to:
  - compute interval boundaries
  - run collectors in parallel when possible
  - normalize and merge outputs
  - return unified JSON
- Collector modules:
  - incident extractor
  - CHG/CM fetch (ServiceNow)
  - manual deployment detector
  - dispatcher modification detector

## 4. Timeframe Utility (Shared)

- Single utility for converting `minutes/hours/days` into `startTs/endTs`
- Ensure consistent timezone handling
- Remove date-only assumptions where possible

## 5. Script Integration

- Continue supporting:
  - `--minutes N`
  - `--hour N` / `--hours N`
  - `--days N`
- Align all script filters to the same computed interval
- Prefer JSON output mode for backend ingestion

## 6. API Layer

- Add/extend endpoint (example): `GET /api/topology-activity`
- Query parameters:
  - `topology`
  - `unit=minutes|hours|days`
  - `value=N`
- Keep existing endpoints temporarily for compatibility

## 7. Frontend (Extension)

- UI controls:
  - topology input/selector
  - timeframe unit + value
- Render grouped sections:
  - Incidents
  - CHG (CM)
  - Manual deploy
  - Dispatcher mods
- Add summary counters and per-section empty states

## 8. Error Handling

- Partial-source failure should not fail the whole response
- Show per-section warning status in UI
- Include request trace fields for easier debugging

## 9. Testing

- Unit tests:
  - timeframe conversion
  - validation
  - normalization
- Integration tests:
  - unified endpoint with `minutes/hours/days`
  - partial failure handling
- Manual validation on known topologies and empty windows

## 10. Rollout

- Phase 1: backend contract + endpoint
- Phase 2: UI integration behind fallback
- Phase 3: topology-by-topology validation
- Phase 4: deprecate old date-only paths

## Future Items (Backlog)

- MSC changes feed integration (beyond current CHG/CM path)
- Users currently logged on the VMs in selected interval/snapshot
- VM-level service restart/redeploy events
- SSH/session audit trail (where permitted)
- Infra drift summary (config/package differences)
- Correlation view: deployments vs incidents vs dispatcher changes
- Export options (CSV/JSON) for unified report
- Scheduled runs and daily summary reports

## Acceptance Criteria

- One request with topology + timeframe returns all required categories
- All categories use the same interval boundaries (`startTs/endTs`)
- Partial failures are isolated and visible per section
- Response schema is stable and UI-friendly
