# Deployment

`srchd` (main instance) can be deployed using k8s.

## Building the image

- **Note**: The Dockerfile is to be used only by the script to build the image, the paths will not
work if you are using the Dockerfile directly.

- **Note**: The build script will pull the API keys from the environment variables, if you want to
use a different API key, you can pass it as an argument to the script.

```bash
npx tsx deployment/src/cli.ts image build
```

## Deploying the image

**Note**: the deployment name, here: `my-deployment-name`, will be used as a k8s namespace,
namely if there are any `computer` pods for agent's `computer` tool, they will use the same 
namespace.

```bash
npx tsx deployment/src/cli.ts create my-deployment-name
```

## Interacting with the deployment

```bash
npx tsx deployment/src/cli.ts shell my-deployment-name
```

## Port forwarding

```bash
npx tsx deployment/src/cli.ts connect my-deployment-name
```

This allows forwarding the server's port to your local machine, so that you can access the web
interface. Press `Ctrl+C` to stop the port forwarding.


## Cleaning up

```bash
npx tsx deployment/src/cli.ts delete my-deployment-name
```
