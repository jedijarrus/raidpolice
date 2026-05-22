/**
 * WarcraftLogs API v1 Client
 * Docs: https://classic.warcraftlogs.com/v1/docs
 */
class WCLApi {
  constructor() {
    // API key is stored server-side and injected by the proxy
    this.baseUrl = '/api';
    this.pointsUsed = 0;
  }

  static extractReportCode(input) {
    if (!input) return null;
    input = input.trim();
    // Full URL: https://classic.warcraftlogs.com/reports/AbCdEf1234
    const urlMatch = input.match(/warcraftlogs\.com\/reports\/([A-Za-z0-9]+)/);
    if (urlMatch) return urlMatch[1];
    // Just the code
    if (/^[A-Za-z0-9]{12,20}$/.test(input)) return input;
    return null;
  }

  async _fetch(endpoint, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}${endpoint}?${qs}`;

    const resp = await fetch(url, { headers: { 'X-CSRF-Token': window.__csrfToken || '' } });
    if (!resp.ok) {
      if (resp.status === 401) throw new Error('Invalid API key. Check your WarcraftLogs V1 Client Key.');
      if (resp.status === 429) throw new Error('Rate limited. Wait a few minutes or subscribe to WarcraftLogs for higher limits.');
      if (resp.status === 400) throw new Error('Bad request. Check the report code.');
      const text = await resp.text();
      throw new Error(`API error ${resp.status}: ${text}`);
    }
    this.pointsUsed += 1; // approximate
    return resp.json();
  }

  /** Get fights and participants for a report */
  async getFights(reportCode, params = {}) {
    return this._fetch(`/report/fights/${reportCode}`, params);
  }

  /** Get table data (damage-done, healing, buffs, casts, summary, etc.) */
  async getTables(reportCode, view, params = {}) {
    return this._fetch(`/report/tables/${view}/${reportCode}`, params);
  }

  /** Get event data */
  async getEvents(reportCode, view, params = {}) {
    return this._fetch(`/report/events/${view}/${reportCode}`, params);
  }

  /** Get guild reports list */
  async getGuildReports(guildName, serverName, region, params = {}) {
    return this._fetch(`/reports/guild/${encodeURIComponent(guildName)}/${encodeURIComponent(serverName)}/${encodeURIComponent(region)}`, params);
  }

  /** Invalidate cache for a report */
  async invalidateCache(reportCode) {
    await fetch('/api/cache/invalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.__csrfToken || '' },
      body: JSON.stringify({ reportCode })
    });
  }

  /** Get TMB attendance data */
  async getTmbAttendance() {
    const resp = await fetch('/api/tmb/attendance', { headers: { 'X-CSRF-Token': window.__csrfToken || '' } });
    if (!resp.ok) return null;
    return resp.json();
  }
}

// Export for use
window.WCLApi = WCLApi;
