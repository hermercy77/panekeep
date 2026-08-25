# Security Policy

## Supported versions

Until the first stable release, security fixes are made on the latest `main` branch. After public releases begin, this section will identify supported release lines.

## Reporting a vulnerability

Do not report vulnerabilities, leaked credentials, or privacy issues in a public GitHub issue.

Use [GitHub's private vulnerability reporting](https://github.com/hermercy77/tab-fridge/security/advisories/new). Include:

- The affected version or commit;
- Reproduction steps and required browser permissions;
- The impact on tabs, browsing metadata, API keys, backups, or AI requests;
- Any suggested mitigation;
- Whether the issue has been disclosed elsewhere.

You should receive an initial acknowledgement within seven days. Please allow time for a fix and coordinated disclosure before publishing details.

## Scope priorities

Reports are especially useful when they involve:

- API key exposure or secret leakage;
- Unintended transmission of tab titles, URLs, or workspace metadata;
- Permission escalation or remote-code execution;
- Import files that escape validation or cause partial browser-state mutation;
- Snapshot, rollback, or cross-window safeguards that can be bypassed.
