# Selecting Elatura's second real workload

The second production adapter should test whether Elatura's contracts transfer to a meaningfully different application. It should begin after the first ChatGPT transform is proven against live evidence and the applicable release gates.

## Selection rule

Choose a workload that exposes reusable strengths and new failure modes while keeping privacy, legal, and maintenance costs bounded.

A candidate should score strongly enough across the full rubric. One spectacular dimension cannot excuse weak reproducibility, unclear authority, or excessive privacy risk.

## Scoring

Score each category from 0 to 4:

- `0` — disqualifying or absent
- `1` — weak
- `2` — usable with significant cost
- `3` — strong
- `4` — unusually strong

Apply the listed weight to each category. The maximum weighted score is 100.

| Category | Weight | Question |
|---|---:|---|
| Pathological value | 20 | Does the ordinary interface become slow, crash-prone, inaccessible, or cognitively difficult at realistic scale? |
| Structured state | 15 | Does the application expose a coherent graph, timeline, document tree, event stream, or paged collection that an adapter can validate? |
| Reproducibility | 15 | Can maintainers create large synthetic or public fixtures and reproduce the failure without private accounts? |
| Authority and jump-back | 10 | Can a local representation preserve a clear authoritative origin and return the user to the exact source region? |
| Contract diversity | 10 | Does the candidate exercise capabilities beyond ChatGPT, such as paging, timeline order, attachments, revisions, or non-branch navigation? |
| Privacy and legal risk | 10 | Can development and testing avoid collecting sensitive third-party content, violating terms, or depending on data the project cannot publish? |
| Maintenance cost | 10 | Are schemas, endpoints, and UI behaviours stable enough for a small project to maintain? |
| Measurement quality | 5 | Can load time, memory, responsiveness, output validity, and fail-open behaviour be measured objectively? |
| User reach | 5 | Would success help a meaningful group of users or prove an important product direction? |

Weighted category score:

```text
(category score / 4) × category weight
```

## Required gates

A candidate leaves research status only when all of these are true:

- the first ChatGPT transform has live correctness and performance evidence
- synthetic fixtures cover the candidate's important state patterns
- authoritative input and output validation rules are documented
- required permissions and origins are narrow and inspectable
- content collection, retention, deletion, and alternate-surface boundaries have security review
- adapter capability declarations match the actual implementation
- fail-open tests cover unknown schema, partial data, cancellation, oversized input, and output rejection
- maintenance ownership is explicit

## Disqualifiers

Reject or defer a candidate with any of these traits:

- useful testing requires publishing private user archives
- authentication depends on exporting cookies, tokens, or browser storage
- the only access path relies on evading access controls or anti-abuse systems
- a remote service must receive private application content
- schema drift cannot be detected before unsafe output reaches the application
- the candidate has no reliable authoritative source or jump-back path
- the ordinary application already solves the large-state problem well enough that Elatura adds little value
- legal or contractual permission remains unclear after review

## Candidate archetypes

### Giant issue or pull-request timelines

Likely strengths:

- natural chronological representation
- public reproducible fixtures
- direct jump-back to comments and events
- paging and revision semantics unlike ChatGPT branches
- objective load and interaction measurements

Likely costs:

- provider-specific event variants
- attachment and collapsed-event handling
- authenticated private repositories require additional privacy review

### Large notebooks

Likely strengths:

- expensive outputs provide clear pathological value
- source, output, and execution-order relationships
- code extraction is central
- public synthetic notebooks are easy to create

Likely costs:

- binary media and rich widget semantics
- local-file and hosted-service transports differ substantially
- editing and execution should remain outside an initial read-only adapter

### Log or deployment consoles

Likely strengths:

- extreme volume and clear working-set policies
- timeline, filtering, and search fit the read-only representation
- bounded public synthetic streams are easy to generate

Likely costs:

- logs often contain secrets and personal data
- real products use streaming protocols and vendor-specific pagination
- retention expectations require careful alignment with the authoritative system

### Long documents or knowledge systems

Likely strengths:

- section navigation and search
- revisions and jump-back
- accessibility value

Likely costs:

- document editing semantics are complex
- rich embeds and collaborative cursors create broad compatibility demands
- some products already virtualize effectively

## Recommended decision process

1. Shortlist three candidates using public information and synthetic fixtures.
2. Score them independently by a builder, adversarial reviewer, and integration reviewer.
3. Record evidence beside every score.
4. Reject any disqualified candidate regardless of total.
5. Prototype detect, validate, fingerprint, and read-only representation before transport integration.
6. Run the shared adapter conformance suite.
7. Select the candidate that gives the strongest contract diversity per unit of privacy and maintenance cost.

## Current leading hypothesis

A giant public issue or pull-request timeline is the strongest research candidate. It tests paging, ordered heterogeneous events, revisions, code blocks, branch-like reply relationships, and exact jump-back while allowing public and synthetic fixtures.

That is a hypothesis for later evaluation, not authorization to implement a production adapter before M1 evidence.
