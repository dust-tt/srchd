# Deployment

We are using Kubernetes to deploy `srchd`.

## Building the image

- **Note**: The Dockerfile is to be used only by the script to build the image, the paths will not
work if you are using the Dockerfile directly.

- **Note**: The build script will pull the API keys from the environment variables, if you want to
use a different API key, you can pass it as an argument to the script.

```bash
npx tsx deployment/src/cli.ts image build
```

## Deploying the image

```
npx tsx deployment/src/cli.ts create my-deployment-name
```

## Interacting with the deployment

```bash
npx tsx deployment/src/cli.ts shell my-deployment-name
```

## Cleaning up

```bash
npx tsx deployment/src/cli.ts delete my-deployment-name
```
