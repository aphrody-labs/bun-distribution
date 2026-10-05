# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Authenticated Google Drive client using local OAuth credentials."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import httpx

from aphrody.errors import AphrodyError, ApiError
from aphrody.google_docs import resolve_access_token


class AuthenticatedDriveClient:
    """Client wrapper for Google Drive operations using local OAuth tokens.

    Supports creating directories, uploading files, and listing files.
    """

    def __init__(
        self,
        token_provider: Any = None,
        http: httpx.Client | None = None,
    ) -> None:
        """Initialize the Drive client.

        Args:
            token_provider: An optional callable that returns a valid access token.
            http: An optional custom httpx Client. If None, a default one is
                created.
        """
        self._token_provider = token_provider or resolve_access_token
        if http is None:
            import httpx

            self._http = httpx.Client(
                timeout=httpx.Timeout(connect=30.0, read=120.0, write=600.0, pool=30.0)
            )
        else:
            self._http = http
        self._owns_http = http is None
        self._closed = False

    def close(self) -> None:
        """Close the underlying HTTP client if owned by this instance."""
        if self._closed:
            return
        self._closed = True
        if self._owns_http:
            self._http.close()

    def __enter__(self) -> AuthenticatedDriveClient:
        self._ensure_open()
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def _ensure_open(self) -> None:
        if self._closed:
            raise AphrodyError("AuthenticatedDriveClient is closed")

    def _headers(self) -> dict[str, str]:
        """Get auth headers with the current refreshed access token."""
        self._ensure_open()
        token = self._token_provider()
        return {"Authorization": f"Bearer {token}"}

    def _request(
        self,
        method: str,
        url: str,
        *,
        json_data: Any = None,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        content: Any = None,
    ) -> httpx.Response:
        """Send an authenticated HTTP request to the Google Drive API."""
        req_headers = self._headers()
        if headers:
            req_headers.update(headers)
        response = self._http.request(
            method,
            url,
            json=json_data,
            params=params,
            headers=req_headers,
            content=content,
        )
        if not response.is_success:
            raise ApiError(response.status_code, response.text, url=url)
        return response

    def get_folder_id(self, name: str) -> str | None:
        """Find the ID of a folder by name.

        Args:
            name: Folder name.

        Returns:
            The folder ID if found, otherwise None.
        """
        url = "https://www.googleapis.com/drive/v3/files"
        q = f"name = '{name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        res = self._request("GET", url, params={"q": q, "fields": "files(id, name)"})
        files = res.json().get("files", [])
        return files[0]["id"] if files else None

    def create_folder(self, name: str, parent_id: str | None = None) -> str:
        """Create a new folder in Google Drive and return its ID.

        Args:
            name: Folder name to create.
            parent_id: Optional ID of the parent folder.

        Returns:
            The ID of the newly created folder.
        """
        url = "https://www.googleapis.com/drive/v3/files"
        body: dict[str, Any] = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
        }
        if parent_id:
            body["parents"] = [parent_id]
        res = self._request("POST", url, json_data=body)
        return res.json()["id"]

    def resolve_or_create_folder(self, name: str) -> str:
        """Find the folder ID or create it if not found.

        Args:
            name: Folder name.

        Returns:
            The resolved or newly created folder ID.
        """
        folder_id = self.get_folder_id(name)
        if not folder_id:
            folder_id = self.create_folder(name)
        return folder_id

    def upload_file(
        self, file_path: str | Path, folder_id: str | None = None
    ) -> dict[str, Any]:
        """Upload a file to Google Drive (with optional parent folder).

        Args:
            file_path: Local path to the file to upload.
            folder_id: Optional parent folder ID in Google Drive.

        Returns:
            The metadata dictionary of the uploaded file.
        """
        self._ensure_open()
        path = Path(file_path)
        file_size = path.stat().st_size
        metadata: dict[str, Any] = {"name": path.name}
        if folder_id:
            metadata["parents"] = [folder_id]

        if file_size > 5 * 1024 * 1024:
            # Resumable upload protocol for large media files (> 5MB)
            init_url = (
                "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable"
            )
            init_headers = self._headers()
            init_headers["Content-Type"] = "application/json; charset=UTF-8"
            content_type = (
                "audio/mpeg"
                if path.suffix.lower() == ".mp3"
                else "application/octet-stream"
            )
            init_headers["X-Upload-Content-Type"] = content_type
            init_headers["X-Upload-Content-Length"] = str(file_size)

            init_res = self._http.post(init_url, headers=init_headers, json=metadata)
            if init_res.status_code != 200:
                raise ApiError(init_res.status_code, init_res.text, url=init_url)

            upload_url = init_res.headers["Location"]
            with open(path, "rb") as f:
                put_headers = {
                    "Content-Length": str(file_size),
                    "Content-Type": content_type,
                }
                put_res = self._http.put(
                    upload_url, headers=put_headers, content=f.read()
                )
                if not put_res.is_success:
                    raise ApiError(put_res.status_code, put_res.text, url=upload_url)
                return put_res.json()

        url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"

        boundary = "-------314159265358979323846"
        headers = {"Content-Type": f"multipart/related; boundary={boundary}"}

        metadata_part = (
            f"--{boundary}\r\n"
            "Content-Type: application/json; charset=UTF-8\r\n\r\n"
            f"{json.dumps(metadata)}\r\n"
        )

        file_part_header = (
            f"--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n"
        )

        file_data = path.read_bytes()
        footer = f"\r\n--{boundary}--"

        body = (
            metadata_part.encode("utf-8")
            + file_part_header.encode("utf-8")
            + file_data
            + footer.encode("utf-8")
        )

        res = self._request("POST", url, headers=headers, content=body)
        return res.json()

    def list_files(self, folder_id: str | None = None) -> list[dict[str, Any]]:
        """List files (optionally filtered by parent folder ID).

        Args:
            folder_id: Optional parent folder ID filter.

        Returns:
            A list of dictionary objects representing the files in the directory.
        """
        url = "https://www.googleapis.com/drive/v3/files"
        q = "trashed = false"
        if folder_id:
            q += f" and '{folder_id}' in parents"
        res = self._request(
            "GET", url, params={"q": q, "fields": "files(id, name, mimeType)"}
        )
        return res.json().get("files", [])

    def move_file_to_folder(self, file_id: str, folder_id: str) -> dict[str, Any]:
        """Move a file or Google Document into a target Google Drive folder."""
        file_info = self._request(
            "GET",
            f"https://www.googleapis.com/drive/v3/files/{file_id}?fields=parents",
        ).json()
        previous_parents = ",".join(file_info.get("parents", []))
        url = (
            f"https://www.googleapis.com/drive/v3/files/{file_id}"
            f"?addParents={folder_id}&removeParents={previous_parents}&fields=id,parents"
        )
        res = self._request("PATCH", url)
        return res.json()

    def create_permission(
        self, file_id: str, role: str = "reader", type_: str = "anyone"
    ) -> dict[str, Any]:
        """Set sharing permissions on a file or folder (e.g. public view)."""
        url = f"https://www.googleapis.com/drive/v3/files/{file_id}/permissions"
        res = self._request("POST", url, json_data={"role": role, "type": type_})
        return res.json()
