"""
================================================================
UQU Academic Assistant — HTTPBearer Auth Dependency
================================================================
Firebase ID Token verification using fastapi.security.HTTPBearer.
Used by all NEW routers added during the JS-to-FastAPI migration.

Existing routers continue to use auth/dependencies.py to keep
the 1:1 migration contract (no behavior change for legacy endpoints).
"""

import logging
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from firebase_admin import auth

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)


async def verify_firebase_token(
    creds: HTTPAuthorizationCredentials | None = Depends(security),
) -> str:
    """Verify a Firebase ID token from the Authorization: Bearer <token> header.

    Returns the Firebase UID on success. Raises HTTP 401 on any failure.
    """
    if creds is None or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="مطلوب تسجيل الدخول — Authorization header مفقود",
        )

    token = creds.credentials

    try:
        decoded = auth.verify_id_token(token)
        return decoded["uid"]
    except auth.ExpiredIdTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="انتهت صلاحية رمز المصادقة — أعد تسجيل الدخول",
        )
    except auth.InvalidIdTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="رمز المصادقة غير صالح",
        )
    except Exception as e:
        logger.warning(f"Auth verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="فشل التحقق من المصادقة",
        )
