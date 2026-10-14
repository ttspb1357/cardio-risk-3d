"""Vercel entrypoint. The FastAPI app (API + built frontend) lives in backend/app.py; Vercel looks for `app` here."""
from backend.app import app  # noqa: F401
