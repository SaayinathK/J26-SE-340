// frontend/src/types/lead-intel.js — the shapes of the Lead Intelligence answers (JSDoc, checked by the editor)
// Source of truth: docs/api/lead-intel/v1/*.yaml (OpenAPI). Keep both in step when the API changes.

/** @typedef {'hot'|'warm'|'cold'} Segment */

/**
 * @typedef {object} Factor          one reason for a score (SHAP, summed per CRM field)
 * @property {string} feature        e.g. "num__time_on_site_sec" or "cat__occupation_Unemployed"
 * @property {number} impact         > 0 raises the score, < 0 lowers it
 * @property {string|number|null} value  the lead's own value
 */

/**
 * @typedef {object} ScoreResult     POST /api/leads/score
 * @property {string} lead_id
 * @property {number} score          0-100 (calibrated chance of buying x 100)
 * @property {Segment} segment
 * @property {Factor[]} top_factors
 * @property {string} model_version
 * @property {{level: 'low'|'medium'|'high', segment_conversion_rate: number}} confidence
 * @property {object|null} alert     set when the lead dropped to a lower group
 * @property {boolean} what_if       true: a CRM lead with changed details (not saved to history)
 * @property {{score: number, segment: Segment, changed: {field: string, label: string}[]}|null} crm
 */

/**
 * @typedef {object} Recommendation  GET /api/leads/{id}/recommendation
 * @property {string} next_best_action
 * @property {string} message_draft
 * @property {{label: string, type: string, text: string}[]} sources
 * @property {boolean} grounded
 * @property {string} policy_check
 * @property {string[]} talking_points
 * @property {number} score
 * @property {Segment} segment
 */

export {};
