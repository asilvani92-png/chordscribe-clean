#!/usr/bin/env bash
set -euo pipefail

# Create & activate virtualenv
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -d ".venv" ]; then
  echo "Creating virtualenv at .venv"
  python3 -m venv .venv
fi

# Activate
# shellcheck source=/dev/null
source .venv/bin/activate

pip install --upgrade pip

if [ -f "backend/requirements.txt" ]; then
  echo "Installing backend Python dependencies..."
  pip install -r backend/requirements.txt
else
  echo "Warning: backend/requirements.txt not found. Skipping pip install."
fi

# Check ffmpeg
if command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg found: $(ffmpeg -version | head -n1)"
else
  echo "ffmpeg not found. On macOS install with: brew install ffmpeg"
  echo "Continuing — scripts will attempt to create a test audio file using Python if ffmpeg is missing."
fi

# Generate a 1s silent test audio at scripts/test_audio.wav
TEST_AUDIO="scripts/test_audio.wav"
if [ -f "$TEST_AUDIO" ]; then
  echo "Test audio already exists at $TEST_AUDIO"
else
  if command -v ffmpeg >/dev/null 2>&1; then
    echo "Generating 1s silent WAV using ffmpeg -> $TEST_AUDIO"
    mkdir -p scripts
    ffmpeg -f lavfi -i anullsrc=cl=stereo:r=44100 -t 1 -q:a 9 -acodec pcm_s16le "$TEST_AUDIO" -y >/dev/null 2>&1
    echo "Created $TEST_AUDIO"
  else
    echo "Generating 1s silent WAV using Python -> $TEST_AUDIO"
    python3 - <<'PY'
import wave,struct
frames = 44100
with wave.open('scripts/test_audio.wav','w') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(44100)
    silence = struct.pack('<h',0)
    data = silence * frames * 2
    w.writeframes(data)
print('Created scripts/test_audio.wav')
PY
  fi
fi

echo "Setup complete. Activate the venv with: source .venv/bin/activate"