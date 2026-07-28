# Security policy

Elatura handles data inside authenticated browser sessions. Treat bugs involving private content, authentication material, cache exposure, or unsafe response transformation as security-sensitive.

Please do not open a public issue containing:

- cookies, tokens, authorization headers, or session identifiers
- private conversation text or attachments
- unredacted browser profiles or benchmark captures
- a working exploit against an Elatura user

Until a dedicated security contact is published, report sensitive findings privately to the repository owner through GitHub's private vulnerability reporting feature when available.

Elatura must never export browser cookies into a standalone unofficial protocol implementation. Unknown schemas and transformation failures must pass through the original response.
