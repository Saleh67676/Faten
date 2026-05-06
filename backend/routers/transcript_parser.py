from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from fastapi.responses import JSONResponse
from schemas.transcript import TranscriptAnalysisResult
from services.transcript import TranscriptParser
from auth.dependencies import get_current_user
import shutil
import os
import tempfile
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/transcript", tags=["Transcript Parser"])


@router.post("/analyze")
async def analyze_transcript(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user)
):
    """
    Parse an academic transcript PDF and return structured student and course data.
    Uses the bounding-box word-level parser (services/transcript.py).
    """
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="يجب أن يكون الملف بصيغة PDF")

    tmp_path = None
    try:
        # ── Save to temp file ──
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name

        # ── Parse ──
        parser = TranscriptParser(tmp_path)
        result: dict = parser.parse()

        # ── Validate via Pydantic (model_validate handles dict→model coercion) ──
        try:
            validated = TranscriptAnalysisResult.model_validate(result)
            return validated
        except Exception as val_err:
            # Pydantic validation failed — return raw dict so UI still works
            logger.warning(f"Pydantic coercion warning (returning raw dict): {val_err}")
            return JSONResponse(content=result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Transcript Parsing Error: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"حدث خطأ أثناء تحليل السجل: {str(e)}"
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass

