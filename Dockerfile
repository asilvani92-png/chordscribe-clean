FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ffmpeg \
    git \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN python -m pip install --upgrade pip setuptools wheel
RUN python -m pip install -r backend/requirements.txt

COPY . .

EXPOSE 8000
CMD ["sh", "-lc", "python -m uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
