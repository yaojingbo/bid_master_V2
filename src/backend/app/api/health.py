"""
Health check API route.
"""
from fastapi import APIRouter
from datetime import datetime

from app.models.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    """
    Health check endpoint.

    Returns:
        Service health status
    """
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0",
    }


@router.get("/")
async def root():
    """
    Root endpoint.

    Returns:
        API information
    """
    return {
        "name": "Bid Master API",
        "version": "1.0.0",
        "docs": "/docs",
    }