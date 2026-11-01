# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability**.

Include what you found, steps to reproduce, and the impact you expect. We aim to acknowledge reports within 5 business days.

## Scope

In scope: the apps in `apps/`, the shared `web-kit` and `core` packages, and deploy configuration in this repository.

Out of scope: third-party services we depend on (Clerk, Railway). Report issues in those to the vendor.

## Secrets

Never commit credentials. If you spot a leaked key in this repository or its history, report it as above so it can be rotated.
