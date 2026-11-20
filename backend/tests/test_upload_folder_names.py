import io

from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import get_settings
from app.infrastructure.storage.local_storage import safe_filename
from app.main import app
from tests.helpers import create_owner_workspace
from tests.test_note_generation_api import _create_note

client = TestClient(app)


def _mask_png() -> bytes:
    # Tiny 1-bit mask, like the files that failed.
    image = Image.new("1", (64, 64), 0)
    image.putpixel((10, 10), 1)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_safe_filename_drops_folders_and_unsafe_characters() -> None:
    assert safe_filename("masks/SX2_KNUCKLE_1.png") == "SX2_KNUCKLE_1.png"
    assert safe_filename("a\\b\\c.png") == "c.png"
    assert safe_filename("../../evil.png") == "evil.png"
    assert safe_filename('what?"<>.png') == "what____.png"
    assert safe_filename("..") == "file"


def test_upload_with_folder_path_in_name_succeeds_inside_storage() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    note_id = _create_note(headers, company_id, owner_member_id)
    root = get_settings().storage_root_path.resolve()

    for name in ["masks/SX2_KNUCKLE_1.png", "../../escape.png"]:
        response = client.post(
            "/research-note-files/upload",
            headers=headers,
            data={"note_id": note_id},
            files={"upload": (name, _mask_png(), "image/png")},
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["file"]["original_name"] == name  # shown as uploaded
        stored = (root / body["file"]["storage_key"]).resolve()
        assert stored.is_relative_to(root) and stored.exists()
        assert body["pages"] and (root / body["pages"][0]["image_storage_key"]).exists()
