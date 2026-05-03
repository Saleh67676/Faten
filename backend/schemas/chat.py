"""
================================================================
UQU Academic Assistant — Chat Schemas
================================================================
"""

from __future__ import annotations
from typing import Literal
from pydantic import BaseModel


class ChatMessage(BaseModel):
    """A single message in the conversation."""
    role: Literal["user", "assistant", "system"]
    content: str


class ChatRequest(BaseModel):
    """Request body for POST /api/chat."""
    messages: list[ChatMessage]
    conversationId: str | None = None


class ActionLog(BaseModel):
    """A logged tool action performed by the agent."""
    tool: str
    args: dict | None = None
    result: dict | None = None


class ChatResponse(BaseModel):
    """Response body for POST /api/chat."""
    success: bool = True
    message: str
    actions: list[dict] = []
    conversationId: str
