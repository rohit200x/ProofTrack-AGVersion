"""Proof photo retrieval, review, flagging, and administrative deletion endpoints."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from app.core.errors import Forbidden, NotFound
from app.db.session import get_db
from app.schemas.delivery import FlagProofRequest, ProofResponse
from app.security.deps import AuthContext, auth_ctx, require_admin, require_manager
from app.services import delivery as delivery_service
from app.storage.base import ObjectNotFound, get_storage

router = APIRouter(prefix="/api/v1/proofs", tags=["Proofs"])


def _authorize(db: Session, ctx: AuthContext, proof) -> None:
    if not delivery_service.can_view_proof(db, ctx.user, proof):
        raise Forbidden("You do not have access to this proof photograph.")


@router.get("/{proof_id}/thumbnail")
def get_thumbnail(proof_id: uuid.UUID, ctx: AuthContext = Depends(auth_ctx), db: Session = Depends(get_db)):
    proof = delivery_service.get_proof(db, proof_id)
    _authorize(db, ctx, proof)
    try:
        obj = get_storage().get(proof.thumbnail_key)
    except ObjectNotFound:
        raise NotFound("Thumbnail file not found in storage.") from None
    return StreamingResponse(
        obj.body,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "private, max-age=3600",
            "Content-Length": str(obj.content_length),
        },
    )


@router.get("/{proof_id}/preview")
def get_preview(proof_id: uuid.UUID, ctx: AuthContext = Depends(auth_ctx), db: Session = Depends(get_db)):
    """Browser-compatible full-size preview (especially useful when the original is HEIC)."""
    proof = delivery_service.get_proof(db, proof_id)
    _authorize(db, ctx, proof)
    storage = get_storage()
    key = proof.preview_key or proof.object_key
    media_type = "image/jpeg" if proof.preview_key else proof.content_type
    try:
        obj = storage.get(key)
    except ObjectNotFound:
        raise NotFound("Preview file not found in storage.") from None
    return StreamingResponse(
        obj.body,
        media_type=media_type,
        headers={
            "Cache-Control": "private, max-age=3600",
            "Content-Length": str(obj.content_length),
        },
    )


@router.get("/{proof_id}/original")
def get_original(
    proof_id: uuid.UUID,
    download: bool = False,
    ctx: AuthContext = Depends(auth_ctx),
    db: Session = Depends(get_db),
):
    proof = delivery_service.get_proof(db, proof_id)
    _authorize(db, ctx, proof)
    try:
        obj = get_storage().get(proof.object_key)
    except ObjectNotFound:
        raise NotFound("Original proof file not found in storage.") from None
    headers = {
        "Cache-Control": "private, max-age=3600",
        "Content-Length": str(obj.content_length),
    }
    if download:
        ext = proof.object_key.rsplit(".", 1)[-1] if "." in proof.object_key else "jpg"
        headers["Content-Disposition"] = f'attachment; filename="proof-{proof.id}.{ext}"'
    return StreamingResponse(obj.body, media_type=proof.content_type, headers=headers)


@router.post("/{proof_id}/flag", response_model=ProofResponse)
def flag_proof(
    proof_id: uuid.UUID,
    body: FlagProofRequest,
    ctx: AuthContext = Depends(require_manager),
    db: Session = Depends(get_db),
):
    proof = delivery_service.flag_proof(db, proof_id, reason=body.reason, actor_id=ctx.user.id)
    return ProofResponse.model_validate(proof)


@router.post("/{proof_id}/resolve", response_model=ProofResponse)
def resolve_proof(
    proof_id: uuid.UUID,
    body: FlagProofRequest,
    ctx: AuthContext = Depends(require_manager),
    db: Session = Depends(get_db),
):
    proof = delivery_service.resolve_proof(db, proof_id, note=body.reason, actor_id=ctx.user.id)
    return ProofResponse.model_validate(proof)


@router.delete("/{proof_id}")
def delete_proof(
    proof_id: uuid.UUID,
    body: FlagProofRequest,
    ctx: AuthContext = Depends(require_admin),
    db: Session = Depends(get_db),
):
    delivery_service.delete_proof(
        db, proof_id, reason=body.reason, actor_id=ctx.user.id, storage=get_storage(), ip=ctx.ip
    )
    return {"message": "Proof deleted and audit event recorded."}
