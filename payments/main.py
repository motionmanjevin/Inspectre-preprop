from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db
from .routes_billing import router as billing_router
from .routes_admin import router as admin_router


def create_app() -> FastAPI:
    init_db()

    app = FastAPI(title="Inspectre Payments Server", version="0.1.0")

    # CORS: allow device backends and admin frontend (configure in prod)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(billing_router)
    app.include_router(admin_router)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app


app = create_app()

