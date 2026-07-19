# Security Policy

## Supported versions

Security fixes are made on the current default branch. Older commits and
unreleased local branches are not supported.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/noahpatterson/emailTriager/security/advisories/new).
Do not open a public issue for an undisclosed vulnerability.

Include the affected commit, configuration or deployment mode, reproduction
steps, expected impact, and any suggested mitigation. Remove Gmail message
contents, OAuth tokens, database credentials, and other personal data from the
report.

You should receive an acknowledgement within seven days. Confirmed reports
will be tracked privately until a fix or documented mitigation is available.

## Security boundaries

Email Triage is a single-owner personal project, not a hardened multi-user
service. It requests Gmail modify access and can change labels or move messages
to Trash. Insecure local mode bypasses authentication and must remain bound to
loopback. Use a dedicated test mailbox and review the deployment warnings in
the README before connecting an account.
