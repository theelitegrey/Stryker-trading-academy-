/* Which repository holds the panel's data. The login screen can override this. */
window.PANEL_CONFIG = {
  owner: 'theelitegrey',
  repo: 'Stryker-trading-academy-',
  branch: 'panel-data',           // data lives here, never on main
  workflow: 'panel-monitor.yml',  // the Actions job that probes and audits
  dir: 'panel',                   // folder on the data branch
};
