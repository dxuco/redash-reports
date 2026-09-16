# Branch Protection Setup

To protect the `main` branch from accidental deployments, follow these steps:

## Via GitHub Web UI

1. Go to https://github.com/dxuco/redash-reports/settings/branches
2. Click "Add rule"
3. Configure:
   - **Branch name pattern**: `main`
   - **Require a pull request before merging**: ✓
     - **Require approvals**: 1
     - **Dismiss stale pull request approvals**: ✓
   - **Require status checks to pass before merging**: ✓
     - **Require branches to be up to date before merging**: ✓
     - **Status checks**: `Deploy to Cloudflare`
   - **Allow force pushes**: Deny
   - **Allow deletions**: Deny
4. Click "Create"

## Benefits

- ✅ Prevents accidental direct pushes to main
- ✅ Requires PR review before deployment
- ✅ Ensures CI/CD passes before merge
- ✅ Protects against force pushes
- ✅ Prevents branch deletion

## Workflow

1. Create feature branch: `git checkout -b feature/my-change`
2. Make changes and push
3. Create Pull Request
4. GitHub Actions automatically tests
5. After approval, merge to main
6. Automatic deployment happens
