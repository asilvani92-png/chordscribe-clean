# Testing ChordScribe Locally

Quick steps to set up a local dev environment, run the backend, and perform smoke tests.

Requirements
- macOS (instructions include `brew`), Python 3.8+, `git`.

1) Setup (creates `.venv` and installs Python deps)

```bash
# from project root
bash scripts/setup.sh
```

The script will attempt to generate a short `scripts/test_audio.wav` using `ffmpeg` if available, otherwise using Python.

2) Run the backend (separate terminal)

```bash
# activate venv
source .venv/bin/activate
# start backend
bash scripts/run.sh
```

Notes:
- First run may download & initialize ML models (Whisper, BasicPitch) and take several minutes.
- Place real Stripe keys in a `.env` file in the repo root if you want to test checkout flows. Example `.env`:

```
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
FRONTEND_URL=http://localhost:8000
ALLOWED_ORIGINS=http://localhost:8000
```

3) Run smoke tests (after backend is running)

```bash
bash scripts/smoke_test.sh
```

What the smoke tests do
- Polls `http://localhost:8000/health` until available
- Calls `/health` and prints output
- If `scripts/test_audio.wav` exists, uploads it to `/analyse` and prints a truncated response

Environment
- Scripts create a `.venv` in the repo root. Activate with `source .venv/bin/activate`.
- Scripts set placeholder Stripe test keys; replace with real test keys in `.env` when needed.

Troubleshooting
- If `ffmpeg` is not installed: `brew install ffmpeg`
- If dependencies fail to install, ensure the venv is active and use `pip install -r backend/requirements.txt` manually.
- If `/analyse` fails, give the backend more time to load models and try again.

Next steps
- Add pytest-based integration tests and CI workflow (optional).
- Add a fast 'mock' mode for backend to avoid loading Whisper during development.