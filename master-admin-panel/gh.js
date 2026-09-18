/* Minimal GitHub REST client for the panel: read/write files on the data
   branch and dispatch the monitor workflow. Token = fine-grained PAT scoped
   to this one repository with Contents: read/write and Actions: read/write. */
(() => {
'use strict';
const API = 'https://api.github.com';
const utf8ToB64 = (s) => btoa(unescape(encodeURIComponent(s)));
const b64ToUtf8 = (s) => decodeURIComponent(escape(atob(s.replace(/\n/g, ''))));

class GitHub {
  constructor({ owner, repo, branch, token }) { Object.assign(this, { owner, repo, branch, token }); this.shas = {}; }
  async req(path, opts = {}) {
    const res = await fetch(API + path, { ...opts, headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${this.token}`, 'x-github-api-version': '2022-11-28', ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) } });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.message || `GitHub ${res.status}`); e.status = res.status; throw e; }
    return data;
  }
  contents(path) { return `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${encodeURIComponent(this.branch)}`; }
  async whoami() { return this.req('/user'); }
  async repoInfo() { return this.req(`/repos/${this.owner}/${this.repo}`); }
  async branchExists() { try { await this.req(`/repos/${this.owner}/${this.repo}/branches/${encodeURIComponent(this.branch)}`); return true; } catch (e) { if (e.status === 404) return false; throw e; } }
  // Create the data branch as an orphan (no parents, one README) so it does
  // not carry a copy of the site.
  async createBranch() {
    const repo = `/repos/${this.owner}/${this.repo}`;
    const blob = await this.req(`${repo}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: '# Master Admin Panel data\n\nManaged by the panel and its GitHub Actions monitor. Do not edit by hand.\n', encoding: 'utf-8' }) });
    const tree = await this.req(`${repo}/git/trees`, { method: 'POST', body: JSON.stringify({ tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob.sha }] }) });
    const commit = await this.req(`${repo}/git/commits`, { method: 'POST', body: JSON.stringify({ message: 'panel: initialise data branch', tree: tree.sha, parents: [] }) });
    await this.req(`${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${this.branch}`, sha: commit.sha }) });
  }
  async readJson(path) {
    try {
      const f = await this.req(this.contents(path), { headers: { 'cache-control': 'no-cache' } });
      this.shas[path] = f.sha;
      return JSON.parse(b64ToUtf8(f.content));
    } catch (e) { if (e.status === 404) { delete this.shas[path]; return null; } throw e; }
  }
  async writeJson(path, obj, message) {
    const body = { message: message || `panel: update ${path}`, content: utf8ToB64(JSON.stringify(obj, null, 2) + '\n'), branch: this.branch };
    const put = async () => { if (this.shas[path]) body.sha = this.shas[path]; const r = await this.req(`/repos/${this.owner}/${this.repo}/contents/${path}`, { method: 'PUT', body: JSON.stringify(body) }); this.shas[path] = r.content.sha; return r; };
    try { return await put(); } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
      // stale sha: refresh and retry once (last write wins per file)
      await this.readJson(path); return put();
    }
  }
  async dispatch(workflowFile, inputs = {}) {
    const info = await this.repoInfo();
    return this.req(`/repos/${this.owner}/${this.repo}/actions/workflows/${workflowFile}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: info.default_branch, inputs }) });
  }
  async lastRun(workflowFile) {
    const r = await this.req(`/repos/${this.owner}/${this.repo}/actions/workflows/${workflowFile}/runs?per_page=1`);
    return r.workflow_runs?.[0] || null;
  }
}
window.PanelGitHub = GitHub;
})();
