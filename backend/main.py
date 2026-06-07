"""
ChordScribe Backend
===================
FastAPI server that handles:
  - Audio analysis (Whisper for lyrics, Basic Pitch for notes/chords)
  - Stripe checkout session creation
  - CORS for frontend
"""

import os
import io
import json
import tempfile
import asyncio
from pathlib import Path
from typing import List, Optional

# Optional imports — guard heavy ML/audio libs so we can run a mock dev mode
try:
    import numpy as np
except Exception:
    np = None

try:
    import librosa
except Exception:
    librosa = None

import stripe
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

# Support a mock mode for fast local development/tests. Set USE_MOCK=1 to enable.
USE_MOCK = os.getenv("USE_MOCK", "0") == "1"

if not USE_MOCK:
    try:
        import whisper
        from basic_pitch.inference import predict as basic_pitch_predict
        from basic_pitch import ICASSP_2022_MODEL_PATH
    except Exception:
        print("Warning: Could not import whisper/basic_pitch; falling back to mock mode.")
        USE_MOCK = True

if USE_MOCK:
    class _MockWhisper:
        def transcribe(self, *args, **kwargs):
            return {"segments": [{"start": 0, "text": "(mock transcription)"}]}

    whisper_model = _MockWhisper()

    def basic_pitch_predict(*args, **kwargs):
        return []
else:
    print("Loading Whisper model...")
    whisper_model = whisper.load_model("medium")
    print("Whisper ready.")


# ── Config ──────────────────────────────────────────────────────
stripe.api_key        = os.getenv("STRIPE_SECRET_KEY", "sk_live_XXXX")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "whsec_XXXX")
FRONTEND_URL          = os.getenv("FRONTEND_URL", "http://localhost:3000")
ALLOWED_ORIGINS       = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8000").split(",")




# ── App ──────────────────────────────────────────────────────────
app = FastAPI(title="ChordScribe API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS + ["*"],  # tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend if built files exist
frontend_path = Path(__file__).parent.parent / "frontend"
if frontend_path.exists():
    app.mount("/static", StaticFiles(directory=str(frontend_path)), name="static")


# ── Health check ─────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "whisper": "ready"}


# ── Main analysis endpoint ───────────────────────────────────────
@app.post("/analyse")
async def analyse(
    audio: UploadFile = File(...),
    outputs: str      = Form(default='["lyrics","chords","tab"]'),
):
    requested = set(json.loads(outputs))
    # If running in mock mode, return a canned response to avoid heavy ML processing
    if USE_MOCK:
        return {
            "song_title": "Mock Track",
            "key": "C major",
            "bpm": 120,
            "time_signature": "4/4",
            "genre": "Mock",
            "capo": None,
            "lyrics_chords": [{"section": "Track", "lines": [{"chords": [{"chord": "C", "position": 0}], "lyric": "(mock transcription)"}]}],
            "unique_chords": [],
            "guitar_tab": "",
            "bass_tab": "",
            "progression_note": "Mock progression.",
        }

    # Save uploaded audio to temp file
    with tempfile.NamedTemporaryFile(
        suffix=get_suffix(audio.filename or "audio.webm"),
        delete=False
    ) as tmp:
        tmp.write(await audio.read())
        tmp_path = tmp.name

    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None, process_audio, tmp_path, requested
        )
        return result
    finally:
        os.unlink(tmp_path)


def get_suffix(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    return ext if ext in {".mp3",".wav",".m4a",".ogg",".webm",".mp4",".flac"} else ".webm"


def process_audio(audio_path: str, requested: set) -> dict:
    """
    Core processing pipeline.
    Runs synchronously in a thread pool to avoid blocking the event loop.
    """

    # ── 1. Load audio ────────────────────────────────────────────
    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    duration = librosa.get_duration(y=y, sr=sr)

    # ── 2. Key & tempo detection ─────────────────────────────────
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
    bpm = round(float(tempo))

    # Key detection using chroma features
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_mean = chroma.mean(axis=1)
    key_names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
    key_idx = int(np.argmax(chroma_mean))
    key_note = key_names[key_idx]

    # Simple major/minor determination via chroma profile comparison
    major_profile = np.array([6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88])
    minor_profile = np.array([6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17])
    rolled_major = np.roll(major_profile, key_idx)
    rolled_minor = np.roll(minor_profile, key_idx)
    major_corr = np.corrcoef(chroma_mean, rolled_major)[0,1]
    minor_corr = np.corrcoef(chroma_mean, rolled_minor)[0,1]
    mode = "major" if major_corr > minor_corr else "minor"
    key_full = f"{key_note} {mode}"

    # ── 3. Chord detection ───────────────────────────────────────
    chords_timeline = detect_chords(y, sr, key_idx, mode)
    unique_chords   = get_unique_chords(chords_timeline)
    progression     = build_progression(chords_timeline)

    # ── 4. Lyrics via Whisper ────────────────────────────────────
    lyrics_data = []
    if "lyrics" in requested or "chords" in requested:
        transcript = whisper_model.transcribe(audio_path, word_timestamps=True)
        lyrics_data = build_lyrics_with_chords(transcript, chords_timeline)

    # ── 5. Guitar tab ────────────────────────────────────────────
    guitar_tab = build_guitar_tab(unique_chords, progression)

    # ── 6. Bass tab ──────────────────────────────────────────────
    bass_tab = build_bass_tab(unique_chords, progression) if "bass" in requested else ""

    # ── 7. Genre guess ───────────────────────────────────────────
    genre = guess_genre(bpm, mode, key_note)

    # ── 8. Build chord diagrams ──────────────────────────────────
    chord_defs = [get_chord_def(c) for c in unique_chords]

    return {
        "song_title":      "Transcribed Track",
        "key":             key_full,
        "bpm":             bpm,
        "time_signature":  "4/4",
        "genre":           genre,
        "capo":            suggest_capo(key_note, mode),
        "lyrics_chords":   lyrics_data,
        "unique_chords":   chord_defs,
        "guitar_tab":      guitar_tab,
        "bass_tab":        bass_tab,
        "progression_note": f"Main progression: {' — '.join(progression[:4])} in {key_full}.",
    }


# ── Chord detection ──────────────────────────────────────────────
CHORD_TEMPLATES = {
    # Major chords
    "C":  [1,0,0,0,1,0,0,1,0,0,0,0],
    "C#": [0,1,0,0,0,1,0,0,1,0,0,0],
    "D":  [0,0,1,0,0,0,1,0,0,1,0,0],
    "D#": [0,0,0,1,0,0,0,1,0,0,1,0],
    "E":  [0,0,0,0,1,0,0,0,1,0,0,1],
    "F":  [1,0,0,0,0,1,0,0,0,1,0,0],
    "F#": [0,1,0,0,0,0,1,0,0,0,1,0],
    "G":  [0,0,1,0,0,0,0,1,0,0,0,1],
    "G#": [1,0,0,1,0,0,0,0,1,0,0,0],
    "A":  [0,1,0,0,1,0,0,0,0,1,0,0],
    "A#": [0,0,1,0,0,1,0,0,0,0,1,0],
    "B":  [0,0,0,1,0,0,1,0,0,0,0,1],
    # Minor chords
    "Cm": [1,0,0,1,0,0,0,1,0,0,0,0],
    "Dm": [0,0,1,0,0,1,0,0,0,1,0,0],
    "Em": [0,0,0,0,1,0,0,1,0,0,0,1],
    "Fm": [1,0,0,0,0,1,0,0,1,0,0,0],
    "Gm": [0,0,1,0,0,0,0,1,0,0,1,0],
    "Am": [0,1,0,0,1,0,0,0,0,1,0,0],
    "Bm": [0,0,0,1,0,0,1,0,0,0,0,1],
}

def detect_chords(y, sr, key_idx, mode):
    """Detect chord changes using chroma features."""
    hop = 4096
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
    times = librosa.times_like(chroma, sr=sr, hop_length=hop)

    results = []
    prev_chord = None

    for i, frame in enumerate(chroma.T):
        best_chord, best_score = "C", -999
        for chord_name, template in CHORD_TEMPLATES.items():
            score = float(np.dot(frame, template))
            if score > best_score:
                best_score = score
                best_chord = chord_name

        if best_chord != prev_chord:
            results.append({"chord": best_chord, "time": float(times[i])})
            prev_chord = best_chord

    return results


def get_unique_chords(timeline):
    seen = []
    for entry in timeline:
        c = entry["chord"]
        if c not in seen:
            seen.append(c)
    return seen[:8]  # cap at 8 unique chords for display


def build_progression(timeline):
    chords = [e["chord"] for e in timeline]
    # Deduplicate consecutive
    prog = []
    for c in chords:
        if not prog or prog[-1] != c:
            prog.append(c)
    return prog[:8]


# ── Lyrics + chord alignment ─────────────────────────────────────
def build_lyrics_with_chords(transcript, chord_timeline):
    """Map Whisper segments to chords by timestamp."""
    sections = {}

    for seg in transcript.get("segments", []):
        t_start = seg["start"]
        text    = seg["text"].strip()
        if not text:
            continue

        # Find chord at this time
        chord_at_time = "C"
        for entry in chord_timeline:
            if entry["time"] <= t_start:
                chord_at_time = entry["chord"]

        # Guess section
        if t_start < 15:
            section = "Intro"
        elif t_start < 45:
            section = "Verse 1"
        elif t_start < 75:
            section = "Chorus"
        elif t_start < 105:
            section = "Verse 2"
        elif t_start < 135:
            section = "Chorus"
        else:
            section = "Outro"

        if section not in sections:
            sections[section] = []

        sections[section].append({
            "chords": [{"chord": chord_at_time, "position": 0}],
            "lyric":  text,
        })

    result = []
    section_order = ["Intro","Verse 1","Chorus","Verse 2","Bridge","Outro"]
    for s in section_order:
        if s in sections:
            result.append({"section": s, "lines": sections[s]})

    # Fallback if Whisper found nothing
    if not result:
        result = [{
            "section": "Track",
            "lines": [{"chords": [{"chord": "—", "position": 0}], "lyric": "(No vocals detected — instrumental track?)"}]
        }]

    return result


# ── Guitar tab builder ───────────────────────────────────────────
CHORD_FRETS = {
    "C":  [-1,3,2,0,1,0],
    "C#": [-1,4,3,1,2,1],
    "D":  [-1,-1,0,2,3,2],
    "D#": [-1,-1,1,3,4,3],
    "E":  [0,2,2,1,0,0],
    "F":  [1,3,3,2,1,1],
    "F#": [2,4,4,3,2,2],
    "G":  [3,2,0,0,0,3],
    "G#": [4,3,1,1,1,4],
    "A":  [-1,0,2,2,2,0],
    "A#": [-1,1,3,3,3,1],
    "B":  [-1,2,4,4,4,2],
    "Cm": [-1,3,5,5,4,3],
    "Dm": [-1,-1,0,2,3,1],
    "Em": [0,2,2,0,0,0],
    "Fm": [1,3,3,1,1,1],
    "Gm": [3,5,5,3,3,3],
    "Am": [-1,0,2,2,1,0],
    "Bm": [-1,2,4,4,3,2],
}

def build_guitar_tab(unique_chords, progression):
    """Build a simple strumming tab from the chord progression."""
    strings = ["e","B","G","D","A","E"]
    # Build tab columns
    cols = []
    for chord in progression[:8]:
        frets = CHORD_FRETS.get(chord, [-1,-1,-1,-1,-1,-1])
        cols.append((chord, frets))

    # Build string lines
    lines = []
    for s_idx in range(6):
        parts = [strings[s_idx] + "|"]
        for _, frets in cols:
            f = frets[s_idx]
            cell = str(f) if f >= 0 else "x"
            parts.append(f"--{cell}--")
        parts.append("|")
        lines.append("".join(parts))

    return "\n".join(lines)


def build_bass_tab(unique_chords, progression):
    """Bass tab uses root notes only."""
    # Bass strings: E A D G (low to high)
    bass_roots = {"C":"3","C#":"4","D":"5","D#":"6","E":"0","F":"1",
                  "F#":"2","G":"3","G#":"4","A":"0","A#":"1","B":"2"}
    strings = ["G","D","A","E"]
    cols = progression[:8]

    lines = []
    for s_label in strings:
        parts = [s_label + "|"]
        for chord in cols:
            root = chord.replace("m","").replace("#","#")
            f = bass_roots.get(root, "0")
            parts.append(f"--{f}--")
        parts.append("|")
        lines.append("".join(parts))

    return "\n".join(lines)


# ── Chord diagram definitions ────────────────────────────────────
def get_chord_def(chord_name: str) -> dict:
    frets = CHORD_FRETS.get(chord_name, [0,0,0,0,0,0])
    is_minor = "m" in chord_name and "maj" not in chord_name
    return {
        "name":  chord_name,
        "type":  "Minor" if is_minor else "Major",
        "frets": frets,
    }


# ── Genre guess ──────────────────────────────────────────────────
def guess_genre(bpm: int, mode: str, key: str) -> str:
    if bpm < 70:
        return "Ballad / Slow"
    elif bpm < 90:
        return "Soul / R&B"
    elif bpm < 110:
        return "Pop"
    elif bpm < 130:
        if mode == "minor":
            return "Rock"
        return "Pop Rock"
    elif bpm < 160:
        return "Punk / Rock"
    else:
        return "Metal / Fast Rock"


# ── Capo suggestion ──────────────────────────────────────────────
CAPO_MAP = {
    "C": None, "G": None, "D": None, "A": None, "E": None,
    "F": "1st fret", "C#": "1st fret", "D#": "3rd fret",
    "G#": "4th fret", "A#": "3rd fret", "F#": "2nd fret", "B": "2nd fret"
}

def suggest_capo(key_note: str, mode: str) -> Optional[str]:
    return CAPO_MAP.get(key_note)


# ── Stripe endpoints ─────────────────────────────────────────────
class CheckoutRequest(BaseModel):
    price_id: str


@app.post("/create-checkout")
async def create_checkout(req: CheckoutRequest):
    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            line_items=[{"price": req.price_id, "quantity": 1}],
            success_url=f"{FRONTEND_URL}/?payment=success",
            cancel_url=f"{FRONTEND_URL}/?payment=cancelled",
            payment_method_types=["card"],
        )
        return {"url": session.url}
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/stripe-webhook")
async def stripe_webhook(request):
    """Handle Stripe webhook events (optional but good practice)."""
    from fastapi import Request
    payload = await request.body()
    sig     = request.headers.get("stripe-signature","")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except Exception:
        raise HTTPException(400, "Invalid webhook signature")

    if event["type"] == "checkout.session.completed":
        # Could store customer in DB here
        pass

    return {"received": True}


# ── Serve frontend SPA ───────────────────────────────────────────
@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    index = frontend_path / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return {"error": "Frontend not found"}
