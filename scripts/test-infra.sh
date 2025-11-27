#!/bin/sh

num_deployments=${1:-1}

function browse() {
  url=$1
  if command -v xdg-open &> /dev/null; then
    xdg-open "$url"
  elif command -v open &> /dev/null; then
    open "$url"
  else
    echo "No browser opener found (xdg-open or open)"
  fi
}

alias infra="npx tsx infra/src/cli.ts"

function srchd() {
  namespace=$1
  kubectl exec -it srchd-$namespace -n $namespace -- npx tsx src/srchd.ts "${@:2}"
}

function check_pod() {
  namespace=$1
  pod_name=$2
  kubectl get pods -n $namespace | awk '{print $1}' | grep -q $pod_name
}

function check_image() {
  image=$1
  name=$2
  echo Checking if $tagless_image docker image is built...
  if docker images | grep -q $image; then
    echo $image image found.
  else
    echo $image image not found. Building...
    if [[ "$name" = "computer" ]]; then
        srchd image build
    elif [[ "$name" = "deployment" ]]; then
        infra image build
    fi
  fi
}

function validate_test() {
  namespace=$1
  echo Checking computers were created
  all="true"

  if check_pod $namespace srchd-$namespace-test-gpt; then
    echo "GPT Pod running..."
  else
    all="false"
  fi
  if check_pod $namespace srchd-$namespace-test-gemini; then
    echo "Gemini Pod running..."
  else
    all="false"
  fi
  if check_pod $namespace srchd-$namespace-test-mistral; then
    echo "Mistral Pod running..."
  else
    all="false"
  fi

  if [ "$all" != "true" ]; then
    echo "Missing computers"
    echo TEST FAILED
  else
    echo TEST SUCCEEDED
  fi
}


function run_agents() {
  namespace=$1
  timeout_sec=$2
  echo Running agents for $2 seconds.
  python3 -c "
import subprocess
import sys
import os
import signal
import time

print('namespace: $namespace')
cmd = ['kubectl', 'exec', '-t', 'srchd-$namespace', '-n', '$namespace', '--', 'npx', 'tsx', 'src/srchd.ts', 'agent',
'run', 'all', '-e', 'test']
print(f'Executing cmd: {cmd}')

# Start process in new process group
proc = subprocess.Popen(cmd,
    stdin=sys.stdin,
    stdout=sys.stdout,
    stderr=sys.stderr,
    preexec_fn=os.setpgrp  # Create new process group
)

try:
    proc.wait(timeout=$timeout_sec)
except subprocess.TimeoutExpired:
    print('Timeout reached, stopping agents...')
    # Kill entire process group
    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    time.sleep(2)
    # Force kill if still alive
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except ProcessLookupError:
        pass
    proc.wait()
except KeyboardInterrupt:
    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    sys.exit(1)
"
  echo Done.
}

function test_deployment() {
  namespace=$1
  infra create $namespace
  sleep 5
  if ! check_pod $namespace srchd-$namespace; then
    echo "Could not deploy"
  fi
  echo "Starting server..."
  infra connect $namespace &
  server_pid=$!
  sleep 2
  echo Creating $namespace experiment
  kubectl exec -it srchd-$namespace -n $namespace -- npx tsx src/srchd.ts experiment create test -p problems/security/tor.problem
  echo Creating agent for 3 providers
  kubectl exec -it srchd-$namespace -n $namespace -- npx tsx src/srchd.ts agent create -m gpt-5 -t high -p security -e test -n gpt
  kubectl exec -it srchd-$namespace -n $namespace -- npx tsx src/srchd.ts agent create -m gemini-2.5-flash -t low -p security -e test -n gemini
  kubectl exec -it srchd-$namespace -n $namespace -- npx tsx src/srchd.ts agent create -m mistral-large-latest -t none -p security -e test -n mistral

  browse "http://localhost:1337/experiments/1"

  run_agents $namespace 30
  echo "Stopping server..."
  kill $server_pid
  validate_test $namespace
  infra delete $namespace
}

check_image "agent-computer" "computer"
check_image "srchd" "deployment"

for i in $(seq 1 $num_deployments); do
  test_deployment "test$i"
done

echo Test complete.
