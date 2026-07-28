# GitHub to CloudBase automatic deployment

The workflow in `.github/workflows/deploy-cloudbase.yml` validates and deploys
the two CloudBase functions and static hosting after a successful push to the
`shan` branch. It can also be started manually from the GitHub Actions page.

## Required GitHub environment secrets

Open the repository on GitHub, then go to:

`Settings` -> `Environments` -> `New environment` -> `production`

Add these environment secrets:

- `TCB_ENV_ID`: the CloudBase environment ID
- `TCB_SECRET_ID`: a Tencent Cloud CAM API SecretId
- `TCB_SECRET_KEY`: the matching SecretKey

Do not add the SecretId or SecretKey to source files, commits, Actions logs, or
chat messages.

## Deployment behavior

- A push to another branch does not deploy production.
- A failed validation does not deploy anything.
- Concurrent deployments are serialized.
- CloudBase business secrets, including future AI provider keys, remain cloud
  function environment variables and are not stored in GitHub source code.

To run the same deployment locally:

```powershell
npm run deploy:cloudbase
```
