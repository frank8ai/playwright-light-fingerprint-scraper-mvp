const BACKENDS = ['A', 'B', 'C'];
const ERROR_TYPES = ['timeout', 'blocked', 'dom_changed', 'captcha', 'network', 'unknown'];

/**
 * @typedef {Object} TaskInput
 * @property {string=} taskType
 * @property {string=} query
 * @property {string=} url
 * @property {string=} site
 * @property {boolean=} legacyDirect
 */

/**
 * @typedef {Object} NormalizedResultItem
 * @property {string} title
 * @property {string} url
 * @property {string} snippet
 * @property {string} source
 * @property {string} capturedAt
 * @property {number} confidence
 */

/**
 * @typedef {Object} NormalizedResult
 * @property {string} requestId
 * @property {'success'|'partial'|'failed'} status
 * @property {'A'|'B'|'C'|''} backendUsed
 * @property {number} fallbackCount
 * @property {string} query
 * @property {boolean} fromCache
 * @property {NormalizedResultItem[]} results
 * @property {{latencyMs:number, attempts:number}} metrics
 * @property {{code:string, message:string, type:'timeout'|'blocked'|'dom_changed'|'captcha'|'network'|'unknown'}} error
 */

module.exports = {
  BACKENDS,
  ERROR_TYPES,
};
