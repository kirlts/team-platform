---
description: /update - Updates the Kairós governance system to its latest official version without affecting your project code.
---

# Update

This workflow updates the Kairós governance files (rules, workflows, skills, templates) to the latest version available in the remote repository, without affecting the user's project documentation.

## Configuration Variables

- **REPO_OWNER:** kirlts
- **REPO_NAME:** kairos
- **BRANCH:** main
- **VERSION_FILE:** kairos-version.txt

## Step 0: Local Version Detection

The first line of `kairos-version.txt` at the root of the local repository is read. This represents the installed version.

## Step 1: Remote Version Detection

The remote version file is read at:

```text
https://raw.githubusercontent.com/{REPO_OWNER}/{REPO_NAME}/{BRANCH}/kairos-version.txt
```

The first line is extracted as the remote version. The rest of the file represents the governance file manifest.

## Step 2: Version Comparison

- If local version == remote version → the system reports "Kairós is up to date" and stops.
- If local version < remote version → the system proceeds with the update.

## Step 3: Change Detection

Using the manifest from the remote `kairos-version.txt`:

For EACH path listed in the remote manifest vs the local manifest:

1. **ADD:** If the path exists in the remote manifest but NOT locally → new file.
2. **MODIFY:** If the path exists in both → potential modification. Both versions (remote and local) are read. If they differ → change detected.
3. **DELETE:** If the path exists in the local manifest but NOT in the remote → file removed in the new version. Also, any resulting empty master directories (like old `skills/` folders) are subsequently purged.

## Step 4: Diff Presentation

The user is presented with a table of detected changes:

| File | Type | Change Description |
| --- | --- | --- |

**The system prevents applying any changes without explicit user approval.**

Files within `docs/` are not touched during an `/update`. They belong to the project, not Kairós.

## Step 5: Application

For each approved file:

- **ADD:** The file is created with remote content.
- **MODIFY:** The local file is replaced with the remote version.
- **DELETE:** The local file is deleted. Its parent directory is purged if it becomes empty.

The local `kairos-version.txt` is updated with the new version and manifest.

## Step 6: Post-Update

- An entry is added to `docs/CHANGELOG.md` under the `[Kairós]` section.
- The user is notified if any new rules require action (e.g., new available workflow).

## Step 7: Template Change Detection

After the update is applied, the system scans the diff for modified files within `.agents/templates/`. If ANY template file was added, modified, or deleted:

1. The system emits a notification:
   > **Template changes detected.** The following templates were modified in this update: [list]. Your project documents in `docs/` may need structural reconciliation. Run `/document` to audit and migrate.
2. The notification is appended to the CHANGELOG entry created in Step 6.

If no template files were changed, no notification is emitted.
