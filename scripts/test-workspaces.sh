#!/bin/sh

num_workspaces=${1:-1}

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

alias workspace="npx tsx src/srchd.ts workspace"

function srchd() {
  workspace_id=$1
  kubectl exec -it srchd-$workspace_id -n $workspace_id -- npx tsx src/srchd.ts "${@:2}"
}

function check_pod() {
  workspace_id=$1
  pod_name=$2
  kubectl get pods -n $workspace_id | awk '{print $1}' | grep -q $pod_name
}

function check_image() {
  image_name=$1
  source=$2
  tagless_image=$(echo $image_name | sed 's/\:.*$//g')
  echo Checking if $tagless_image docker image is built...
  if docker images | grep -q $tagless_image; then
    echo $tagless_image image found.
  else
    echo $tagless_image image not found. Building...
    docker build -t $image_name $source
  fi
}

function validate_test() {
  workspace_id=$1
  echo Checking computers were created
  all="true"

  if check_pod $workspace_id srchd-$workspace_id-test-gpt; then
    echo "GPT Pod running..."
  else
    all="false"
  fi
  if check_pod $workspace_id srchd-$workspace_id-test-gemini; then
    echo "Gemini Pod running..."
  else
    all="false"
  fi
  if check_pod $workspace_id srchd-$workspace_id-test-mistral; then
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
  workspace_id=$1
  timeout_sec=$2
  echo Running agents for $2 seconds.
  python3 -c "
import subprocess
import sys
import os
import signal
import time

print('workspaceId: $workspace_id')
cmd = ['kubectl', 'exec', '-t', 'srchd-$workspace_id', '-n', '$workspace_id', '--', 'npx', 'tsx', 'src/srchd.ts', 'agent',
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

function test_workspace() {
  workspace_id=$1
  workspace create $workspace_id
  sleep 5
  if ! check_pod $workspace_id srchd-$workspace_id; then
    echo "Could not deploy"
  fi
  echo "Starting server..."
  workspace connect $workspace_id &
  server_pid=$!
  sleep 2
  echo Creating $workspace_id experiment
  srchd $workspace_id experiment create test -p problems/security/tor.problem
  echo Creating agent for 3 providers
  srchd $workspace_id agent create -p openai -m gpt-5 -t high --tool web --tool computer -s prompts/researcher.md -e test -n gpt
  srchd $workspace_id agent create -p gemini -m gemini-2.5-flash -t low --tool web --tool computer -s prompts/researcher.md -e test -n gemini
  srchd $workspace_id agent create -p mistral -m mistral-large-latest -t none --tool web --tool computer -s prompts/researcher.md -e test -n mistral

  browse "http://localhost:1337/experiments/1"

  run_agents $workspace_id 30
  echo "Stopping server..."
  kill $server_pid
  validate_test $workspace_id
  workspace delete $workspace_id
}

check_image "agent-computer:base" ./src/computer
check_image "srchd:latest" .

for i in $(seq 1 $num_workspaces); do
  test_workspace "test$i"
done

echo Test complete.
