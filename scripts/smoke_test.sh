#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

HEALTH_URL="http://localhost:8000/health"
ANALYSE_URL="http://localhost:8000/analyse"
TEST_AUDIO="scripts/test_audio.wav"

# Wait for backend to be ready (timeout 90s)
echo "Waiting for backend to respond at $HEALTH_URL"
MAX=90
i=0
while [ $i -lt $MAX ]; do
  if curl -sSf "$HEALTH_URL" >/dev/null 2>&1; then
    echo "Backend is up"
    break
  fi
  i=$((i+1))
  sleep 1
done

if [ $i -ge $MAX ]; then
  echo "Timed out waiting for backend at $HEALTH_URL"
  exit 2
fi

echo "Calling health endpoint:"
curl -s "$HEALTH_URL" | sed -n '1,200p'

echo "\nRunning analyse (if $TEST_AUDIO exists):"
if [ -f "$TEST_AUDIO" ]; then
  echo "Uploading $TEST_AUDIO to $ANALYSE_URL"
  curl -s -F "audio=@$TEST_AUDIO" -F 'outputs=["lyrics","chords"]' "$ANALYSE_URL" | sed -n '1,200p'
else
  echo "No test audio at $TEST_AUDIO — skip analyse step"
fi

echo "Smoke tests complete."