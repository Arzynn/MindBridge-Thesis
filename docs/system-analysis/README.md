# MindBridge System Analysis

This documentation set describes the MindBridge source as inspected on
October 4, 2026 (revision 2: re-checked against the supplied project archive). It is intended for a student project report and should be
updated when the source, database schema, or deployment configuration changes.

## Contents

| Artifact | Description |
| --- | --- |
| [Data Flow Diagrams](dfd.md) | Context (Level 0), Level 1, and Level 2 flows |
| [Data Dictionary](data-dictionary.md) | Database columns, types, constraints, and meanings |
| [Structure Chart](structure-chart.md) | Source modules and function responsibilities |
| [HIPO](hipo.md) | System hierarchy and input-process-output descriptions |
| [Structured English](structured-english.md) | Readable, implementation-aligned workflow descriptions |
| [Pseudocode](pseudocode.md) | Algorithms for authentication, chat/review, and DASS-21 |
| [Entity-Relationship Diagram](erd.md) | SQL-backed entities and relationship cardinalities |
| [Configuration Management Plan](configuration-management-plan.md) | Source control, change, build, migration, and release guidance |
| [Verification Report](verification-report.md) | Findings, corrections made in this revision, and open questions |

## Scope and conventions

- `backend/` and `frontend/` are maintained source. `apps-script/` is generated
  deployment output from `build-gas.js`.
- Database structure is based on `database/schema.sql` and
  `database/migrations/20261004_dass21_screening.sql`.
- Mermaid diagrams are supplied alongside explanatory text and tables. Mermaid
  support depends on the viewer.
- **Verified** means directly supported by source/schema. **Gated** means
  implemented but disabled pending configuration or approval.
  **Prototype/incomplete** means only part of a user-facing flow exists.
  **Unknown** means the inspected code does not establish the claim.
- Diagrams model intended application data paths, not a guarantee of
  transactional behavior, authorization effectiveness, deployment availability,
  or clinical suitability.
- No real credentials, deployment identifiers, or student records are included.

## Verified implementation notes

- Apps Script serves pages through `doGet()` and client code calls server
  functions with `google.script.run`.
- Supabase access is made server-side through REST. The backend uses a
  service-role key, which is privileged and bypasses RLS; server-side role and
  session validation remains a critical boundary.
- Gemini is used for counselor-reviewed draft generation. No OpenRouter client
  was found in the inspected source.
- DASS-21 submission is gated by Script Properties for approved consent and
  review policy. Local unit tests cover the DASS-21 implementation but not live
  Apps Script, Supabase, Gemini, or browser behavior.
- Sign-in accepts a stored credential equal to the typed password as well as the
  salted SHA-256 format (verification report F-03).
- The student chat page does not display counselor replies; no backend function
  returns chat messages to the student (F-06).
- Counselor self-registration is a prototype page with no backend endpoint.
- The archive reviewed contained no Git metadata; hidden folders may have been
  omitted from the zip, so confirm on the original folder.

## Evidence limits of this revision

Directly re-checked: `backend/*.gs` (all 12 files), `database/*.sql` and the
migration, `frontend/js/ui.js` and the page scripts that call server functions,
and the generated `apps-script/` output (the `.gs` files are byte-identical to
`backend/`). **Not present in the archive and therefore not re-verified:**
`build-gas.js`, `tests/`, `docs/architecture.md`, `docs/setup.md`,
`docs/testing.md`, `.gitignore`, `.env.example`, `.clasp.json.example`. Any
statement about those files is carried forward from an earlier revision and is
labeled as such. No comparison against the project's own `docs/` was possible,
so code-versus-documentation conflicts there remain unchecked.

## Source traceability

Primary evidence: `backend/`, `frontend/`, `database/`, and the generated
`apps-script/` output. Carried forward but not re-verified: `tests/dass21.test.js`,
`build-gas.js`, `docs/architecture.md`, `docs/setup.md`, `docs/testing.md`.
Each artifact identifies its more specific sources.

## Reading order for a report

1. DFD (context, then Level 1, then Level 2), 2. ERD and Data Dictionary,
3. Structure Chart and HIPO, 4. Structured English and Pseudocode,
5. Configuration Management Plan, 6. Verification Report (limitations).
