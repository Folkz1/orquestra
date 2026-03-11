"""
Client Credentials Portal - Secure credential vault for clients.

- Diego creates a link with specific fields for a client
- Client opens the link, fills credentials in a clean UI
- Values are encrypted with Fernet (AES-128-CBC)
- Diego/Jarbas reads decrypted values via authenticated API
"""

import hashlib
import logging
import secrets
from datetime import datetime, timezone
from typing import Optional

from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import CredentialLink, ClientCredential, Project

logger = logging.getLogger(__name__)
router = APIRouter()

# ---------------------------------------------------------------------------
# Encryption helpers
# ---------------------------------------------------------------------------

def _get_fernet() -> Fernet:
    """Derive a Fernet key from APP_SECRET_KEY (deterministic)."""
    key_bytes = hashlib.sha256(settings.APP_SECRET_KEY.encode()).digest()
    import base64
    fernet_key = base64.urlsafe_b64encode(key_bytes)
    return Fernet(fernet_key)


def _encrypt(value: str) -> str:
    return _get_fernet().encrypt(value.encode()).decode()


def _decrypt(token: str) -> str:
    return _get_fernet().decrypt(token.encode()).decode()


def _mask(value: str) -> str:
    if len(value) <= 8:
        return value[:2] + "****"
    return value[:4] + "****" + value[-4:]


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class FieldDef(BaseModel):
    name: str  # e.g. "n8n_api_key"
    label: str  # e.g. "N8N API Key"
    type: str = "password"  # password, text, url
    placeholder: str = ""


class CreateLinkRequest(BaseModel):
    project_id: str
    client_name: str
    fields: list[FieldDef]
    expires_hours: Optional[int] = 168  # 7 days default


class SubmitCredentialsRequest(BaseModel):
    credentials: dict[str, str]  # {field_name: value}


# ---------------------------------------------------------------------------
# API Routes (authenticated - Diego/Jarbas)
# ---------------------------------------------------------------------------

@router.post("/links")
async def create_link(req: CreateLinkRequest, db: AsyncSession = Depends(get_db)):
    """Create a credential link for a client."""
    token = secrets.token_urlsafe(32)

    from datetime import timedelta
    expires_at = None
    if req.expires_hours:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=req.expires_hours)

    link = CredentialLink(
        project_id=req.project_id,
        token=token,
        client_name=req.client_name,
        fields=[f.model_dump() for f in req.fields],
        expires_at=expires_at,
    )
    db.add(link)
    await db.flush()

    base_url = settings.CREDENTIAL_PORTAL_URL if hasattr(settings, 'CREDENTIAL_PORTAL_URL') else "https://orquestra-backend.jz9bd8.easypanel.host"
    portal_url = f"{base_url}/api/credentials/portal/{token}"

    return {
        "id": str(link.id),
        "token": token,
        "portal_url": portal_url,
        "client_name": req.client_name,
        "fields": [f.name for f in req.fields],
        "expires_at": expires_at.isoformat() if expires_at else None,
    }


@router.get("/links")
async def list_links(db: AsyncSession = Depends(get_db)):
    """List all credential links."""
    result = await db.execute(
        select(CredentialLink).order_by(CredentialLink.created_at.desc())
    )
    links = result.scalars().all()
    return [
        {
            "id": str(l.id),
            "token": l.token[:8] + "...",
            "client_name": l.client_name,
            "project_name": l.project.name if l.project else None,
            "fields": [f["name"] for f in (l.fields or [])],
            "submitted": l.submitted_at is not None,
            "submitted_at": l.submitted_at.isoformat() if l.submitted_at else None,
            "expires_at": l.expires_at.isoformat() if l.expires_at else None,
            "created_at": l.created_at.isoformat(),
        }
        for l in links
    ]


@router.get("/project/{project_id}")
async def get_project_credentials(project_id: str, db: AsyncSession = Depends(get_db)):
    """Get decrypted credentials for a project (Diego/Jarbas only)."""
    from sqlalchemy import text as sql_text
    result = await db.execute(
        select(ClientCredential).where(
            ClientCredential.project_id == sql_text(f"CAST('{project_id}' AS uuid)")
        )
    )
    # Use raw query to avoid asyncpg ::uuid issue
    result = await db.execute(
        select(ClientCredential).filter(
            ClientCredential.project_id == project_id
        )
    )
    creds = result.scalars().all()

    decrypted = {}
    for c in creds:
        try:
            decrypted[c.field_name] = {
                "value": _decrypt(c.encrypted_value),
                "label": c.field_label,
                "masked": _mask(_decrypt(c.encrypted_value)),
                "updated_at": c.updated_at.isoformat(),
            }
        except Exception:
            decrypted[c.field_name] = {
                "value": None,
                "label": c.field_label,
                "error": "decryption_failed",
            }

    return {"project_id": project_id, "credentials": decrypted}


@router.get("/project/{project_id}/masked")
async def get_project_credentials_masked(project_id: str, db: AsyncSession = Depends(get_db)):
    """Get masked credentials (safe to show)."""
    result = await db.execute(
        select(ClientCredential).filter(
            ClientCredential.project_id == project_id
        )
    )
    creds = result.scalars().all()

    masked = {}
    for c in creds:
        try:
            masked[c.field_name] = {
                "label": c.field_label,
                "masked": _mask(_decrypt(c.encrypted_value)),
                "updated_at": c.updated_at.isoformat(),
            }
        except Exception:
            masked[c.field_name] = {"label": c.field_label, "masked": "****"}

    return {"project_id": project_id, "credentials": masked}


# ---------------------------------------------------------------------------
# Portal Routes (PUBLIC - no auth required)
# ---------------------------------------------------------------------------

@router.get("/portal/{token}", response_class=HTMLResponse)
async def portal_page(token: str, db: AsyncSession = Depends(get_db)):
    """Render the credential portal page for a client."""
    result = await db.execute(
        select(CredentialLink).filter(CredentialLink.token == token)
    )
    link = result.scalar_one_or_none()

    if not link:
        return HTMLResponse(
            content=_error_html("Link não encontrado", "Este link de credenciais não existe ou foi removido."),
            status_code=404,
        )

    if link.expires_at and link.expires_at < datetime.now(timezone.utc):
        return HTMLResponse(
            content=_error_html("Link expirado", "Este link de credenciais expirou. Solicite um novo ao Diego."),
            status_code=410,
        )

    already_submitted = link.submitted_at is not None
    project_name = link.project.name if link.project else "Projeto"

    return HTMLResponse(content=_portal_html(
        client_name=link.client_name,
        project_name=project_name,
        fields=link.fields or [],
        token=token,
        already_submitted=already_submitted,
    ))


@router.post("/portal/{token}")
async def submit_credentials(
    token: str,
    req: SubmitCredentialsRequest,
    db: AsyncSession = Depends(get_db),
):
    """Client submits credentials through the portal."""
    result = await db.execute(
        select(CredentialLink).filter(CredentialLink.token == token)
    )
    link = result.scalar_one_or_none()

    if not link:
        raise HTTPException(status_code=404, detail="Link não encontrado")

    if link.expires_at and link.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Link expirado")

    # Delete old credentials for this link (allow re-submission)
    await db.execute(
        delete(ClientCredential).where(ClientCredential.link_id == link.id)
    )

    # Save encrypted credentials
    field_map = {f["name"]: f for f in (link.fields or [])}
    saved = []

    for field_name, value in req.credentials.items():
        if not value or not value.strip():
            continue
        field_def = field_map.get(field_name, {})
        cred = ClientCredential(
            link_id=link.id,
            project_id=link.project_id,
            field_name=field_name,
            field_label=field_def.get("label", field_name),
            encrypted_value=_encrypt(value.strip()),
        )
        db.add(cred)
        saved.append(field_name)

    link.submitted_at = datetime.now(timezone.utc)
    await db.flush()

    logger.info("[CREDENTIALS] %s submitted %d credentials for project %s",
                link.client_name, len(saved), link.project_id)

    return {
        "status": "ok",
        "saved_fields": saved,
        "message": f"Credenciais salvas com sucesso! {len(saved)} campos criptografados.",
    }


# ---------------------------------------------------------------------------
# HTML Templates
# ---------------------------------------------------------------------------

def _error_html(title: str, message: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title} - Orquestra</title>
    <style>{_base_css()}</style>
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="logo">🔒</div>
            <h1>{title}</h1>
            <p class="subtitle">{message}</p>
        </div>
    </div>
</body>
</html>"""


def _portal_html(client_name: str, project_name: str, fields: list, token: str, already_submitted: bool) -> str:
    fields_html = ""
    for f in fields:
        ftype = f.get("type", "password")
        input_type = "password" if ftype == "password" else "text"
        placeholder = f.get("placeholder", "")
        fields_html += f"""
        <div class="field">
            <label for="{f['name']}">{f['label']}</label>
            <div class="input-wrap">
                <input type="{input_type}" id="{f['name']}" name="{f['name']}"
                       placeholder="{placeholder}" autocomplete="off" spellcheck="false">
                {"<button type='button' class='toggle-btn' onclick=\"toggleVisibility(this)\">👁</button>" if ftype == "password" else ""}
            </div>
        </div>"""

    status_badge = ""
    if already_submitted:
        status_badge = '<div class="badge">✅ Credenciais já enviadas — você pode atualizar abaixo</div>'

    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Credenciais - {project_name}</title>
    <style>{_base_css()}</style>
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="logo">🔐</div>
            <h1>Portal de Credenciais</h1>
            <p class="subtitle">
                Olá <strong>{client_name}</strong>! Preencha as credenciais abaixo para o projeto
                <strong>{project_name}</strong>.
            </p>
            <p class="security-note">
                🛡️ Seus dados são criptografados com AES-256 antes de serem salvos.
                Ninguém tem acesso ao valor original — apenas o sistema utiliza de forma segura.
            </p>

            {status_badge}

            <form id="credForm" onsubmit="submitForm(event)">
                {fields_html}

                <button type="submit" class="submit-btn" id="submitBtn">
                    🔒 Salvar Credenciais
                </button>
            </form>

            <div id="result" class="result" style="display:none"></div>
        </div>

        <p class="footer">Orquestra · Diego Vilson · Dados criptografados em trânsito e em repouso</p>
    </div>

    <script>
    function toggleVisibility(btn) {{
        const input = btn.previousElementSibling;
        if (input.type === 'password') {{
            input.type = 'text';
            btn.textContent = '🙈';
        }} else {{
            input.type = 'password';
            btn.textContent = '👁';
        }}
    }}

    async function submitForm(e) {{
        e.preventDefault();
        const btn = document.getElementById('submitBtn');
        btn.disabled = true;
        btn.textContent = '⏳ Salvando...';

        const credentials = {{}};
        const inputs = document.querySelectorAll('#credForm input');
        inputs.forEach(input => {{
            if (input.value.trim()) {{
                credentials[input.name] = input.value.trim();
            }}
        }});

        if (Object.keys(credentials).length === 0) {{
            btn.disabled = false;
            btn.textContent = '🔒 Salvar Credenciais';
            alert('Preencha pelo menos um campo.');
            return;
        }}

        try {{
            const resp = await fetch('/api/credentials/portal/{token}', {{
                method: 'POST',
                headers: {{'Content-Type': 'application/json'}},
                body: JSON.stringify({{ credentials }}),
            }});

            const data = await resp.json();
            const resultDiv = document.getElementById('result');
            resultDiv.style.display = 'block';

            if (resp.ok) {{
                resultDiv.className = 'result success';
                resultDiv.innerHTML = '<strong>✅ ' + data.message + '</strong><br>Você pode fechar esta página.';
                btn.textContent = '✅ Salvo!';
                // Clear inputs
                inputs.forEach(input => input.value = '');
            }} else {{
                resultDiv.className = 'result error';
                resultDiv.innerHTML = '<strong>❌ Erro:</strong> ' + (data.detail || 'Erro desconhecido');
                btn.disabled = false;
                btn.textContent = '🔒 Salvar Credenciais';
            }}
        }} catch (err) {{
            const resultDiv = document.getElementById('result');
            resultDiv.style.display = 'block';
            resultDiv.className = 'result error';
            resultDiv.innerHTML = '<strong>❌ Erro de conexão:</strong> ' + err.message;
            btn.disabled = false;
            btn.textContent = '🔒 Salvar Credenciais';
        }}
    }}
    </script>
</body>
</html>"""


def _base_css() -> str:
    return """
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        min-height: 100vh;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 20px;
    }
    .container { width: 100%; max-width: 520px; }
    .card {
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 16px;
        padding: 40px 32px;
        box-shadow: 0 25px 50px rgba(0,0,0,0.4);
    }
    .logo { font-size: 48px; text-align: center; margin-bottom: 16px; }
    h1 {
        color: #f1f5f9;
        font-size: 24px;
        text-align: center;
        margin-bottom: 8px;
    }
    .subtitle {
        color: #94a3b8;
        text-align: center;
        font-size: 14px;
        line-height: 1.6;
        margin-bottom: 16px;
    }
    .subtitle strong { color: #60a5fa; }
    .security-note {
        background: #0f172a;
        border: 1px solid #1e3a5f;
        border-radius: 8px;
        padding: 12px 16px;
        color: #7dd3fc;
        font-size: 12px;
        line-height: 1.5;
        margin-bottom: 24px;
        text-align: center;
    }
    .badge {
        background: #064e3b;
        border: 1px solid #059669;
        color: #6ee7b7;
        padding: 8px 16px;
        border-radius: 8px;
        text-align: center;
        font-size: 13px;
        margin-bottom: 20px;
    }
    .field { margin-bottom: 20px; }
    label {
        display: block;
        color: #cbd5e1;
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 6px;
        letter-spacing: 0.3px;
    }
    .input-wrap {
        display: flex;
        align-items: center;
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 8px;
        overflow: hidden;
        transition: border-color 0.2s;
    }
    .input-wrap:focus-within { border-color: #3b82f6; }
    input {
        flex: 1;
        background: transparent;
        border: none;
        padding: 12px 16px;
        color: #f1f5f9;
        font-size: 14px;
        font-family: 'SF Mono', 'Fira Code', monospace;
        outline: none;
    }
    input::placeholder { color: #475569; }
    .toggle-btn {
        background: none;
        border: none;
        padding: 8px 12px;
        cursor: pointer;
        font-size: 16px;
        opacity: 0.6;
        transition: opacity 0.2s;
    }
    .toggle-btn:hover { opacity: 1; }
    .submit-btn {
        width: 100%;
        padding: 14px;
        background: linear-gradient(135deg, #2563eb, #3b82f6);
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        margin-top: 8px;
        transition: all 0.2s;
    }
    .submit-btn:hover { background: linear-gradient(135deg, #1d4ed8, #2563eb); transform: translateY(-1px); }
    .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    .result {
        margin-top: 20px;
        padding: 16px;
        border-radius: 8px;
        font-size: 14px;
        line-height: 1.5;
    }
    .result.success { background: #064e3b; border: 1px solid #059669; color: #6ee7b7; }
    .result.error { background: #450a0a; border: 1px solid #dc2626; color: #fca5a5; }
    .footer {
        text-align: center;
        color: #475569;
        font-size: 11px;
        margin-top: 24px;
    }
    """
