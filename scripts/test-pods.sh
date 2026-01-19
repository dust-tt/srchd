#!/bin/sh

TIMEOUT=${1:-30}

export NAMESPACE="test"
echo Using NAMESPACE=$NAMESPACE

alias srchd="npx tsx src/srchd.ts"
function check_pod() {
    kubectl get pods -n test | awk '{print $1}' | grep -q $1
}

echo Backing up db...
echo Cheking if backup already exists...
if [ -f db.sqlite.bkp ]; then
  echo Backup already exists, reinitializing test-db
  rm db.sqlite
  touch db.sqlite && npx drizzle-kit push
else
  mv db.sqlite db.sqlite.bkp
  echo Creating test db...
  touch db.sqlite && npx drizzle-kit push
fi
echo "Done."


echo Checking if docker image is built...
if docker images | grep -q "agent-computer"; then
  echo agent-computer image found.
else
  echo agent-computer image not found. Building...
  docker build -t agent-computer:base ./src/computer
fi

echo Creating test experiment
srchd experiment create test -p problems/security/tor.problem
echo Creating agent for 3 providers
srchd agent create -p security-browse -m gpt-5 -t high -e test -n gpt
srchd agent create -p security-browse -m gemini-2.5-flash -t low -e test -n gemini
srchd agent create -p security-browse -m mistral-large-latest -t none -e test -n mistral

echo Running agents for $TIMEOUT seconds.
python3 -c "
import subprocess
import sys
import os
import signal
import time

env = os.environ.copy()
env['NAMESPACE'] = '$NAMESPACE'
print(f\"Namespace: {env['NAMESPACE']}\")

# Start process in new process group
proc = subprocess.Popen(
    ['npx', 'tsx', 'src/srchd.ts', 'agent', 'run', 'all', '-e', 'test'],
    env=env,
    preexec_fn=os.setpgrp  # Create new process group
)

try:
    proc.wait(timeout=$TIMEOUT)
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

echo Checking computers were created
all="true"

if check_pod srchd-test-test-gpt; then
  echo "GPT Pod running..."
else
  all="false"
fi
if check_pod srchd-test-test-gemini; then
  echo "Gemini Pod running..."
else
  all="false"
fi
if check_pod srchd-test-test-mistral; then
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

echo Cleaning up...
echo Deleting pods...
kubectl delete pod -n test --all
echo Deleting namespace...
kubectl delete namespace test
echo Deleting test db...
rm db.sqlite
echo Restoring db backup...
mv db.sqlite.bkp db.sqlite

echo Test complete.
