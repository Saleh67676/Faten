"""
================================================================
UQU Academic Assistant — Authentication Dependencies
================================================================
Firebase ID Token verification as a FastAPI dependency.
Handles both authenticated users and initial signup scenarios.
"""

from fastapi import Header, HTTPException
from firebase_admin import auth
import logging

logger = logging.getLogger(__name__)


async def get_current_user(authorization: str = Header(default="")) -> str:
    """Verify Firebase ID token from Authorization header.

    Usage in routers:
        @router.post("/endpoint")
        async def endpoint(user_id: str = Depends(get_current_user)):
            ...
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="مطلوب تسجيل الدخول — Authorization header مفقود"
        )

    token = authorization[7:]  # Remove "Bearer " prefix

    try:
        decoded = auth.verify_id_token(token)
        return decoded["uid"]
    except auth.ExpiredIdTokenError:
        raise HTTPException(
            status_code=401,
            detail="انتهت صلاحية رمز المصادقة — أعد تسجيل الدخول"
        )
    except auth.InvalidIdTokenError:
        raise HTTPException(
            status_code=401,
            detail="رمز المصادقة غير صالح"
        )
    except Exception as e:
        logger.warning(f"Auth verification failed: {e}")
        raise HTTPException(
            status_code=401,
            detail="فشل التحقق من المصادقة"
        )


async def get_current_user_optional(authorization: str = Header(default="")) -> str:
    """Graceful auth — returns user ID or a development fallback.

    For endpoints that should work during development without Firebase Auth.
    In production, set REQUIRE_AUTH=true to disable the fallback.
    """
    if not authorization or not authorization.startswith("Bearer "):
        logger.debug("No auth token — using dev fallback user")
        return "dev_user_anonymous"

    # If a token IS provided, STRICTLY extract and verify it. NO silent fallback!
    return await get_current_user(authorization)

