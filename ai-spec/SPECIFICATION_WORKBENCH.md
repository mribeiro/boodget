# boodget — Workbench Specification

## 0. Instructions for Claude Code

This specification is an extension to `SPECIFICATION.md` and `SPECIFICATION_MONTHLY_EXPENSES.md`. Read all three before writing any code.

All architecture, auth, users, dossiers, and deployment rules defined in `SPECIFICATION.md` apply here without exception.

The Workbench section is already visible in the UI as "Coming Soon" (per the main spec). This document defines its full implementation.

Before generating any files, propose the folder structure and any schema changes, and wait for approval.

Do not overwrite existing files unless explicitly instructed.

---

## 1. Overview

The Workbench is a scenario calculator tool within a dossier. It allows users to model how their income is distributed across expenses and savings, using several configurable parameters.

**Key principle: all calculations are performed client-side.** Server requests are only permitted for loading data (snapshots, templates). No calculations are ever triggered by server calls.

Whenever any parameter changes, all dependent values must be recalculated immediately, without any user interaction (no submit button, no page reload).

---

## 2. Snapshots

- The Workbench state can be saved as a named **snapshot**.
- Snapshots are scoped per dossier (like months and cycles).
- Any user with access to the dossier can create, view, edit, or delete snapshots.
- A snapshot captures the full state of the Workbench at save time: all sections, all values, all classifications, all decompositions.
- An existing saved snapshot can be **duplicated**. The duplicate is created with a new name (e.g. "Copy of [original name]") and is fully independent of the original.
- The Workbench also has an **unsaved working state** (the active session). The user can save it at any time as a new snapshot or overwrite an existing one.

---

## 2.1 Working State

- When the user opens the Workbench without loading a snapshot, the working state is **pre-populated from the current templates** (Monthly Expenses, Annual Expenses, Distributions). Income entries start empty.
- The working state is **ephemeral** — it is not persisted between sessions. If the user navigates away without saving, changes are lost.
- On open, the Workbench decides its initial state from the dossier's saved snapshot count: if exactly **one** snapshot exists, it is **silently auto-loaded**; if **zero** or **two or more** snapshots exist, the working state is built fresh from the current templates instead (with no "last used" memory in the 2+ case). A "New from scratch" button is always available to reset to the template-based working state regardless of which path was taken on open.
- If the user has unsaved changes in the working state and attempts to load a snapshot, the system must **warn** that unsaved changes will be lost and ask for confirmation before proceeding.

## 2.2 Saving Snapshots

- Saving always **overwrites** the currently loaded snapshot in place.
- To create a new snapshot, the user must **duplicate** an existing snapshot and then edit and save the duplicate.
- The duplicate is created with a new name (e.g. "Copy of [original name]") and is fully independent of the original.

---

## 3. Sections

The Workbench is composed of the following sections:

1. Income
2. Monthly Expenses
3. Annual Expenses
4. Distributions
5. Summary

All sections are visible simultaneously. Recalculation is triggered instantly on any value change.

Each section is **collapsed by default**, showing only its summary row. The user can expand a section to view and edit its entries. The collapsed state shows enough information to understand the section at a glance (i.e. the summary values).

---

## 4. Income

- Allows multiple entries, each with a **name** and a **monthly value**.
- Entries can be added and removed freely.
- No link to any external template.
- The total income is the sum of all entry values.

---

## 5. Monthly Expenses

### 5.1 Template Integration

- On load, the section is pre-populated from the **Monthly Expenses template** (defined in Dossier Settings — see `SPECIFICATION_MONTHLY_EXPENSES.md`).
- For **fixed expenses**: use the expense value (ignore day of payment).
- For **budget expenses**: use the budget maximum value.
- Template-derived entries are visually distinguished from ad-hoc entries (e.g. a label or icon indicating "from template").
- Changes made in the Workbench **never affect the template** unless an explicit sync action is performed.

### 5.2 Must/Want Classification

- Each expense entry (template-derived or ad-hoc) must be classified as **Must** or **Want**.
- This classification is stored in the template and can also be set/edited directly in the template (in Dossier Settings).
- When syncing from template, the classification stored in the template is applied.
- Entries **without a classification** (not yet defined in the template) are displayed without a default classification but with a **visual highlight** (e.g. warning colour) indicating that a classification must be set before the entry contributes correctly to summaries.

### 5.3 Ad-hoc Entries

- The user can add new expense lines at any time.
- Ad-hoc entries are visually identified as such throughout the session.
- Ad-hoc entries can be freely edited and removed.
- Removing a template-derived entry is also permitted and does not affect the template.

### 5.4 Sync: Template → Workbench

- A **"Sync from template"** button is available.
- Behaviour:
  - All template-derived entries in the Workbench are reset to the current template values (name, value, classification).
  - Template entries that do not exist in the Workbench are added.
  - **Ad-hoc entries are preserved unchanged.**
- This action does not affect the template.

### 5.5 Sync: Workbench → Template

- A **"Sync to template"** button is available.
- Before proceeding, the system must display a **confirmation dialog** warning that the entire Monthly Expenses template will be discarded and replaced.
- Behaviour:
  - The entire Monthly Expenses template is discarded and replaced with the current Workbench entries (both template-derived and ad-hoc).
  - For entries that already exist in the template: the **day of payment is preserved** from the original template entry.
  - For **new entries** (ad-hoc, not previously in the template):
    - If the expense is **fixed**: the system requests the **day of payment inline**, before syncing. The user must enter this value per new fixed entry before the sync can proceed.
    - If the expense is **budget**: no day of payment is needed.
  - Classification (Must/Want) is written to the template.
- This action modifies the template.

### 5.6 Section Summary

A summary is displayed within this section showing:

| Field | Calculation |
|---|---|
| Total monthly expenses | Sum of all entry values |
| Total Must | Sum of values classified as Must |
| Total Want | Sum of values classified as Want |

---

## 6. Annual Expenses

### 6.1 Template Integration

- On load, the section is pre-populated from the **Annual Expenses template** (a new template, separate from the Monthly Expenses template, defined in Dossier Settings).
- The Annual Expenses template is scoped per dossier.
- Changes in the Workbench never affect the template unless an explicit sync is performed.

### 6.2 Fields

Each annual expense entry has:

| Field | Description |
|---|---|
| Name | Free text |
| Value | Annual amount |
| Classification | Must or Want |
| Monthly average | Calculated automatically: Value / 12 (read-only, displayed inline) |

> Note: day/month of payment exists **only in the template**, not in the Workbench. The Workbench only stores name, value, and classification.

### 6.3 Ad-hoc Entries, Removal

- Same rules as Monthly Expenses: ad-hoc entries are visually identified, can be added and removed freely without affecting the template.
- Entries without a classification are displayed with a **visual highlight** indicating that classification is required.

### 6.4 Sync: Template → Workbench

- Same logic as Monthly Expenses:
  - Template-derived entries are reset to current template values.
  - Ad-hoc entries are preserved.

### 6.5 Sync: Workbench → Template

- Before proceeding, the system must display a **confirmation dialog** warning that the entire Annual Expenses template will be discarded and replaced.
- The entire Annual Expenses template is discarded and replaced with the current Workbench entries.
- For entries already in the template: **day/month of payment is preserved**.
- For new entries (ad-hoc):
  - The system requests the **day and month of payment inline** before syncing.
  - The user must provide this per new entry before the sync can proceed.
- Classification (Must/Want) is written to the template.

### 6.6 Section Summary

| Field | Calculation |
|---|---|
| Total annual expenses | Sum of all entry annual values |
| Total Must (annual) | Sum of annual values classified as Must |
| Total Want (annual) | Sum of annual values classified as Want |
| Total Must (monthly avg) | Sum of monthly averages classified as Must |
| Total Want (monthly avg) | Sum of monthly averages classified as Want |
| Total monthly average | Sum of all monthly averages |

---

## 7. Distributions

### 7.1 Template Integration

- On load, the section is pre-populated from the **Distributions template** (the same template used in Monthly Expenses cycles — see `SPECIFICATION_MONTHLY_EXPENSES.md`).
- Changes in the Workbench never affect the template unless an explicit sync is performed.

### 7.2 Must/Want/Save Decomposition

- Each distribution entry can be decomposed into up to three components: **Must**, **Want**, and **Save**.
- Any combination is valid (e.g. only Save, or Must + Save, or all three).
- **The sum of all components must equal the total distribution value.** The UI must enforce this constraint and provide real-time feedback if the sum does not match.
- This decomposition is stored in the Distributions template (does not affect cycles).

### 7.3 Ad-hoc Entries, Removal

- Same rules as the other sections.

### 7.4 Sync: Template → Workbench

- Same logic: template-derived entries are reset (including decomposition), ad-hoc entries are preserved.

### 7.5 Sync: Workbench → Template

- Before proceeding, the system must display a **confirmation dialog** warning that the entire Distributions template will be discarded and replaced.
- The entire Distributions template is discarded and replaced with the current Workbench entries.
- Decomposition (Must/Want/Save) is written to the template.
- No additional fields need to be requested for new entries (distributions have no day of payment).

### 7.6 Section Summary

| Field | Calculation |
|---|---|
| Total distributions | Sum of all distribution values |
| Total Must | Sum of Must components across all distributions |
| Total Want | Sum of Want components across all distributions |
| Total Save | Sum of Save components across all distributions |

---

## 8. Global Summary

A dedicated summary section aggregates values across all sections. All monetary values are in euros (€). Percentages are relative to Total Income.

| Field | Calculation |
|---|---|
| Total Income | Sum of all income entries |
| Total Must | Monthly Expenses (Must) + Annual Expenses (Must monthly avg) + Distributions (Must) |
| Total Want | Monthly Expenses (Want) + Annual Expenses (Want monthly avg) + Distributions (Want) |
| Total Save | Distributions (Save) only |
| Leftover | Total Income − Total Must − Total Want − Total Save |
| % Must | Total Must / Total Income |
| % Want | Total Want / Total Income |
| % Save | Total Save / Total Income |
| % Leftover | Leftover / Total Income |

> Annual expenses contribute their **monthly average (value / 12)** to the global summary totals.

---

## 9. Template Schema Changes

The following new data must be persisted:

### 9.1 Monthly Expenses Template
- Add `classification` field to each expense entry: `must` or `want`.

### 9.2 Annual Expenses Template (new)
- New template per dossier, stored in Dossier Settings.
- Each entry: `name`, `value`, `day_of_payment` (calendar day), `month_of_payment` (1–12), `classification` (`must` or `want`).

### 9.3 Distributions Template
- Add decomposition fields to each distribution entry: `must_amount`, `want_amount`, `save_amount` (all nullable, default null/0).
- Constraint: if any decomposition value is set, `must_amount + want_amount + save_amount` must equal `value`. This is enforced at the application layer.

---

## 10. Settings UI Changes

- The Annual Expenses template must be accessible from Dossier Settings, alongside the existing Monthly Expenses template.
- The `classification` field (Must/Want) must be editable directly in the Monthly Expenses template UI.
- The Must/Want/Save decomposition must be editable directly in the Distributions template UI.

---

## 11. Navigation & Access

- The Workbench follows the same navigation and access patterns as the Capital and Monthly Expenses sections.
- All users with access to the dossier can use the Workbench, create snapshots, and perform sync operations.
- Snapshots are listed and accessible within the dossier's Workbench area.

---

## 12. Out of Scope (this phase)

- Breakdown of income by type or source
- Multi-currency support
- Workbench comparison between snapshots
- Notifications or reminders
- Export of Workbench results
