// Mirrors an issue's type and criticality labels (the conventions in CLAUDE.md →
// "GitHub Issue Conventions") into the matching single-select fields of the owner's
// GitHub Projects (v2) board, adding the issue to the board first if it isn't on it.
//
// Run from .github/workflows/project-fields.yml via actions/github-script. The board is
// owned by the user account, not the repository, so the workflow's GITHUB_TOKEN can't
// reach it — the `github` client passed in must be authenticated with a PAT that has the
// `project` scope (the PROJECT_TOKEN secret).

// Label → field mapping. Labels are matched case-insensitively (GitHub treats label names
// that way too), and the chosen label is matched to a field option by name, also
// case-insensitively — so the board's option spelling doesn't have to match exactly.
const DIMENSIONS = [
  {
    field: 'Type',
    labels: ['bug', 'likely real bug', 'idea', 'improvement', 'tech debt', 'documentation'],
  },
  {
    field: 'Criticality',
    labels: ['blocker', 'critical', 'major', 'minor', 'trivial'],
  },
];

const norm = (s) => String(s).trim().toLowerCase();

// Pure: which option each field should hold for this set of label names. Returns
// { [fieldName]: labelName | null } — null means none of that dimension's labels is present.
// If several are present (shouldn't happen under the conventions), the first in DIMENSIONS
// order wins, which for Criticality is the most severe.
function resolveDesiredValues(labelNames) {
  const present = new Set(labelNames.map(norm));
  const out = {};
  for (const { field, labels } of DIMENSIONS) {
    out[field] = labels.find((l) => present.has(l)) ?? null;
  }
  return out;
}

// Pure: turn desired label names into field updates against the board's actual fields.
// `fields` is [{ id, name, options: [{ id, name }] }]; `current` is { [fieldName]: optionName }.
// A dimension with no label present is only cleared when `clearMissing` is set (i.e. a label
// was just removed) — otherwise a value set by hand on the board is left alone.
function planUpdates(desired, fields, current, { clearMissing }) {
  const updates = [];
  const warnings = [];
  for (const [fieldName, labelName] of Object.entries(desired)) {
    const field = fields.find((f) => norm(f.name) === norm(fieldName));
    if (!field) {
      warnings.push(`Project has no single-select field named "${fieldName}"`);
      continue;
    }
    if (labelName == null) {
      if (clearMissing && current[field.name] != null) updates.push({ field, option: null });
      continue;
    }
    const option = field.options.find((o) => norm(o.name) === norm(labelName));
    if (!option) {
      warnings.push(`Field "${field.name}" has no option matching label "${labelName}"`);
      continue;
    }
    if (norm(current[field.name] ?? '') !== norm(option.name)) updates.push({ field, option });
  }
  return { updates, warnings };
}

async function findProject(github, owner, title, number) {
  const { user } = await github.graphql(
    `query($login: String!) {
      user(login: $login) {
        projectsV2(first: 50) {
          nodes {
            id number title
            fields(first: 50) {
              nodes { ... on ProjectV2SingleSelectField { id name options { id name } } }
            }
          }
        }
      }
    }`,
    { login: owner }
  );
  const projects = user?.projectsV2?.nodes ?? [];
  const project = number
    ? projects.find((p) => p.number === Number(number))
    : projects.find((p) => norm(p.title) === norm(title));
  if (!project) {
    throw new Error(
      `No project ${number ? `#${number}` : `titled "${title}"`} found for user ${owner} ` +
        `(visible: ${projects.map((p) => `#${p.number} "${p.title}"`).join(', ') || 'none'}). ` +
        'Check PROJECT_TITLE / PROJECT_NUMBER and that PROJECT_TOKEN has the `project` scope.'
    );
  }
  const fields = project.fields.nodes.filter((f) => f && f.options);
  return { id: project.id, title: project.title, fields };
}

async function getItem(github, project, owner, repo, issueNumber) {
  const { repository } = await github.graphql(
    `query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          id
          labels(first: 50) { nodes { name } }
          projectItems(first: 20) {
            nodes {
              id
              project { id }
              fieldValues(first: 30) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field { ... on ProjectV2SingleSelectField { name } }
                  }
                }
              }
            }
          }
        }
      }
    }`,
    { owner, repo, number: issueNumber }
  );
  const issue = repository.issue;
  const labels = issue.labels.nodes.map((l) => l.name);
  let item = issue.projectItems.nodes.find((i) => i.project.id === project.id);
  if (!item) {
    const res = await github.graphql(
      `mutation($project: ID!, $content: ID!) {
        addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } }
      }`,
      { project: project.id, content: issue.id }
    );
    item = { id: res.addProjectV2ItemById.item.id, fieldValues: { nodes: [] }, added: true };
  }
  const current = {};
  for (const v of item.fieldValues.nodes) {
    if (v && v.field && v.name != null) current[v.field.name] = v.name;
  }
  return { itemId: item.id, added: !!item.added, labels, current };
}

async function applyUpdate(github, projectId, itemId, { field, option }) {
  if (option) {
    await github.graphql(
      `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $project, itemId: $item, fieldId: $field,
          value: { singleSelectOptionId: $option }
        }) { projectV2Item { id } }
      }`,
      { project: projectId, item: itemId, field: field.id, option: option.id }
    );
  } else {
    await github.graphql(
      `mutation($project: ID!, $item: ID!, $field: ID!) {
        clearProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field }) {
          projectV2Item { id }
        }
      }`,
      { project: projectId, item: itemId, field: field.id }
    );
  }
}

async function syncIssue({ github, core, project, owner, repo, issueNumber, clearMissing }) {
  const { itemId, added, labels, current } = await getItem(github, project, owner, repo, issueNumber);
  const desired = resolveDesiredValues(labels);
  const { updates, warnings } = planUpdates(desired, project.fields, current, { clearMissing });
  for (const w of warnings) core.warning(`#${issueNumber}: ${w}`);
  for (const u of updates) await applyUpdate(github, project.id, itemId, u);
  const summary = updates.map((u) => `${u.field.name}=${u.option ? u.option.name : '(cleared)'}`);
  core.info(`#${issueNumber}${added ? ' (added to board)' : ''}: ${summary.join(', ') || 'no change'}`);
}

// Entry point for actions/github-script.
async function run({ github, context, core }) {
  const owner = process.env.PROJECT_OWNER || context.repo.owner;
  const title = process.env.PROJECT_TITLE || "Boodget's main board";
  const project = await findProject(github, owner, title, process.env.PROJECT_NUMBER);
  core.info(`Syncing into project "${project.title}"`);

  const { owner: repoOwner, repo } = context.repo;

  if (context.eventName === 'issues') {
    await syncIssue({
      github, core, project, owner: repoOwner, repo,
      issueNumber: context.payload.issue.number,
      clearMissing: context.payload.action === 'unlabeled',
    });
    return;
  }

  // workflow_dispatch: backfill every issue in the requested state (PRs excluded).
  const state = context.payload.inputs?.state || 'open';
  const issues = await github.paginate(github.rest.issues.listForRepo, {
    owner: repoOwner, repo, state, per_page: 100,
  });
  for (const issue of issues.filter((i) => !i.pull_request)) {
    await syncIssue({ github, core, project, owner: repoOwner, repo, issueNumber: issue.number, clearMissing: false });
  }
}

module.exports = run;
module.exports.resolveDesiredValues = resolveDesiredValues;
module.exports.planUpdates = planUpdates;
module.exports.DIMENSIONS = DIMENSIONS;
