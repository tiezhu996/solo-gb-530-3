#!/usr/bin/env bash
set -euo pipefail

api_root="${API_ROOT:-http://127.0.0.1:19530/api/v1}"
body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT
last_body=""
checks=0

request() {
  local label="$1"
  local expected="$2"
  local method="$3"
  local path="$4"
  local token="${5:-}"
  local payload="${6:-}"
  local args=(-sS -o "$body_file" -w "%{http_code}" -X "$method")
  if [[ -n "$token" ]]; then
    args+=(-H "Authorization: Bearer $token")
  fi
  if [[ -n "$payload" ]]; then
    args+=(-H "Content-Type: application/json" --data "$payload")
  fi
  local status
  status="$(curl "${args[@]}" "$api_root$path")"
  last_body="$(cat "$body_file")"
  checks=$((checks + 1))
  if [[ "$status" != "$expected" ]]; then
    printf 'FAIL %-38s expected=%s actual=%s body=%s\n' "$label" "$expected" "$status" "$last_body" >&2
    exit 1
  fi
  printf 'PASS %-38s HTTP %s\n' "$label" "$status"
}

require_json() {
  local expression="$1"
  local message="$2"
  if ! jq -e "$expression" >/dev/null <<<"$last_body"; then
    printf 'FAIL response assertion: %s body=%s\n' "$message" "$last_body" >&2
    exit 1
  fi
}

request "unauthenticated workers denied" 401 GET "/workers"

request "planner login" 200 POST "/auth/login" "" '{"username":"planner","password":"Planner#530"}'
planner_token="$(jq -r '.data.token' <<<"$last_body")"
request "RPO login" 200 POST "/auth/login" "" '{"username":"rpo","password":"RPO#Review530"}'
rpo_token="$(jq -r '.data.token' <<<"$last_body")"
request "admin login" 200 POST "/auth/login" "" '{"username":"admin","password":"Admin#530"}'
admin_token="$(jq -r '.data.token' <<<"$last_body")"

request "RPO cannot create worker" 403 POST "/workers" "$rpo_token" '{"worker_code":"DENIED-530","display_name":"Denied","authorization_level":"L1","annual_limit_msv":20,"administrative_limit_msv":12,"profile_status":"active","period_start":"2026-01-01T00:00:00Z"}'

request "create threshold test worker" 201 POST "/workers" "$planner_token" '{"worker_code":"QA-530","display_name":"QA Dose Worker","authorization_level":"Controlled area QA","annual_limit_msv":1.0,"administrative_limit_msv":0.5,"profile_status":"active","period_start":"2026-01-01T00:00:00Z"}'
worker_id="$(jq -r '.data.id' <<<"$last_body")"
require_json '.data.remaining_legal_msv == 1' "new worker legal margin"

occurred_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
request "create pending exposure" 201 POST "/exposures" "$planner_token" "$(jq -nc --argjson worker "$worker_id" --arg at "$occurred_at" '{worker_id:$worker,source_ref:"QA-SRC-530",occurred_at:$at,dose_msv:0.4,note:"offline QA source"}')"
exposure_id="$(jq -r '.data.id' <<<"$last_body")"
require_json '.data.quality_flag == "pending"' "new exposure starts pending"

request "reject duplicate source_ref" 409 POST "/exposures" "$planner_token" "$(jq -nc --argjson worker "$worker_id" --arg at "$occurred_at" '{worker_id:$worker,source_ref:"QA-SRC-530",occurred_at:$at,dose_msv:0.4,note:"duplicate must fail"}')"
require_json '.error.code == "duplicate_source_ref"' "duplicate source error code"

request "RPO verifies exposure" 200 POST "/exposures/$exposure_id/verify" "$rpo_token" '{"quality_flag":"verified","note":"Independent source check completed"}'
require_json '.data.quality_flag == "verified"' "quality transition"

request "create immutable correction chain" 201 POST "/exposures/$exposure_id/correct" "$rpo_token" "$(jq -nc --arg at "$occurred_at" '{source_ref:"QA-SRC-530-C1",replacement_dose_msv:0.3,occurred_at:$at,note:"corrected laboratory value"}')"
require_json '.data.original.id > 0 and .data.reversal.dose_msv == -0.4 and .data.replacement.dose_msv == 0.3 and .data.reversal.correction_of_id == .data.original.id and .data.replacement.correction_of_id == .data.reversal.id' "correction chain links and signed doses"

request "duplicate correction rejected" 409 POST "/exposures/$exposure_id/correct" "$rpo_token" "$(jq -nc --arg at "$occurred_at" '{source_ref:"QA-SRC-530-C2",replacement_dose_msv:0.2,occurred_at:$at,note:"second correction must fail"}')"
require_json '.error.code == "correction_chain_conflict"' "single immutable successor"

request "create high projection plan" 201 POST "/plans" "$planner_token" "$(jq -nc --argjson worker "$worker_id" '{plan_code:"QA-ALARA-530-HI",worker_id:$worker,work_area:"QA controlled bay",task_category:"Source fixture check",estimated_rate_msvh:2.0,planned_minutes:45,controls:["temporary shielding","remote handling"]}')"
plan_id="$(jq -r '.data.id' <<<"$last_body")"
plan_version="$(jq -r '.data.version' <<<"$last_body")"

request "create comparison plan" 201 POST "/plans" "$planner_token" "$(jq -nc --argjson worker "$worker_id" '{plan_code:"QA-ALARA-530-LO",worker_id:$worker,work_area:"QA controlled bay",task_category:"Remote survey",estimated_rate_msvh:0.1,planned_minutes:30,controls:["distance markers","remote reading"]}')"
comparison_plan_id="$(jq -r '.data.id' <<<"$last_body")"

period_end="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
request "calculate immutable assessment" 201 POST "/assessments" "$planner_token" "$(jq -nc --argjson plan "$plan_id" --argjson version "$plan_version" --arg end "$period_end" '{plan_id:$plan,period_end:$end,version:$version}')"
assessment_id="$(jq -r '.data.id' <<<"$last_body")"
assessed_version="$(jq -r '.data.plan_version' <<<"$last_body")"
require_json '.data.period_dose_msv == 0.3 and .data.projected_dose_msv == 1.8 and .data.risk_band == "above_legal" and .data.evidence.requires_manual_review == true' "corrected total, projection and threshold escalation"

request "compare two time-weighted scenarios" 200 POST "/assessments/compare" "$planner_token" "$(jq -nc --argjson first "$plan_id" --argjson second "$comparison_plan_id" --arg end "$period_end" '{plan_ids:[$first,$second],period_end:$end}')"
require_json '.data.scenarios | length == 2' "two comparison scenarios"

request "submit assessment to RPO" 200 POST "/assessments/$assessment_id/submit" "$planner_token" "$(jq -nc --argjson version "$assessed_version" '{version:$version}')"
review_version="$(jq -r '.data.plan_version' <<<"$last_body")"
require_json '.data.assessment_status == "submitted"' "assessment submitted"

request "planner cannot perform RPO review" 403 POST "/assessments/$assessment_id/review" "$planner_token" "$(jq -nc --argjson version "$review_version" '{version:$version,decision:"accept",note:"planner must not review"}')"

request "RPO records planning acceptance" 200 POST "/assessments/$assessment_id/review" "$rpo_token" "$(jq -nc --argjson version "$review_version" '{version:$version,decision:"accept",note:"Planning evidence independently reviewed; site permit remains separate."}')"
require_json '.data.assessment_status == "accepted" and .data.risk_band == "above_legal"' "human review records decision without changing risk"

request "duplicate review rejected" 409 POST "/assessments/$assessment_id/review" "$rpo_token" "$(jq -nc --argjson version "$review_version" '{version:$version,decision:"reject",note:"duplicate state transition"}')"

request "audit visible to RPO" 200 GET "/audit?page_size=100" "$rpo_token"
require_json '(.data | length) >= 8 and ([.data[].action] | index("assessment.reviewed")) != null' "audit contains reviewed transition"

request "worker total reflects correction" 200 GET "/workers/$worker_id" "$admin_token"
require_json '.data.period_dose_msv == 0.3' "period total uses original plus reversal plus replacement"

printf 'ALL %d API CHECKS PASSED\n' "$checks"
