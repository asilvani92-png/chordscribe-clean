#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -d ".venv" ]; then
  echo ".venv not found — run scripts/setup.sh first"
  exit 1
fi

# shellcheck source=/dev/null
source .venv/bin/activate

# Load .env if present
if [ -f ".env" ]; then
  echo "Loading environment variables from .env"
  set -o allexport
  # shellcheck disable=SC1091
  source .env
  set +o allexport
fi

# Export placeholder test vars if not set
: "${STRIPE_SECRET_KEY:=sk_test_placeholder}"
: "${STRIPE_WEBHOOK_SECRET:=whsec_test_placeholder}"
: "${FRONTEND_URL:=http://localhost:8000}"
: "${ALLOWED_ORIGINS:=http://localhost:8000}"
export STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET FRONTEND_URL ALLOWED_ORIGINS PYTHONUNBUFFERED=1

cd backend

echo "Starting backend (Uvicorn) on http://0.0.0.0:8000"
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload