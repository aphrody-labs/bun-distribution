# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Deep Research agentic module with iterative grounded search loops and markdown compilation."""

from __future__ import annotations

import logging
from pathlib import Path

from aphrody.auth import credentials as _credentials
from aphrody.vertex import resolve_location, resolve_project

logger = logging.getLogger(__name__)


class DeepResearcher:
    """Agentic loop that queries Gemini with Google Search grounding, extracts sources, and synthesizes reports."""

    def __init__(
        self,
        *,
        project: str | None = None,
        location: str | None = None,
        model: str = "gemini-2.5-flash",
    ) -> None:
        """Initialize the Deep Researcher.

        Args:
            project: Google Cloud project id override.
            location: Google Cloud region override.
            model: Gemini model used for synthesis and queries.
        """
        self.project = resolve_project(project)
        self.location = resolve_location(location)
        self.model = model

    def conduct_research(
        self,
        topic: str,
        depth: int = 2,
        out: str | Path = "research_report.md",
        dry_run: bool = False,
    ) -> Path:
        """Conduct iterative research and save a synthesized report.

        Args:
            topic: Research subject or query.
            depth: Number of iterative query rounds (minimum 1, typically 2 or 3).
            out: Report file path.
            dry_run: If True, save a preview stating that no research ran.

        Returns:
            The Path where the report was saved.
        """
        if not topic.strip():
            raise ValueError("research topic must not be empty")
        if depth < 1:
            raise ValueError("research depth must be at least one")
        out_path = Path(out)

        if dry_run:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(
                f"# Research preview: {topic}\n\n"
                f"Planned search rounds: {depth}. No research or source verification was performed.\n",
                encoding="utf-8",
            )
            return out_path

        try:
            from google import genai
            from google.genai import types as gx

            creds = _credentials.load_google_credentials()
            client = genai.Client(
                vertexai=True,
                project=self.project,
                location=self.location,
                credentials=creds,
            )

            # Enable Google Search grounding tool
            config = gx.GenerateContentConfig(
                tools=[gx.Tool(google_search=gx.GoogleSearch())]
            )

            current_query = topic
            sources: list[dict[str, str]] = []
            findings: list[str] = []

            for step in range(1, depth + 1):
                logger.info(
                    f"Researching round {step}/{depth} for query: '{current_query}'..."
                )
                res = client.models.generate_content(
                    model=self.model,
                    contents=f"Conduct research on: '{current_query}'. Focus on facts, details, and references.",
                    config=config,
                )

                if not res.text or not res.text.strip():
                    raise RuntimeError(f"research round {step} returned no findings")
                findings.append(res.text)

                # Extract grounding sources from metadata
                g_meta = (
                    getattr(res.candidates[0], "grounding_metadata", None)
                    if res.candidates
                    else None
                )
                if g_meta:
                    chunks = getattr(g_meta, "grounding_chunks", [])
                    for chunk in chunks:
                        web = getattr(chunk, "web", None)
                        if web:
                            title = getattr(web, "title", "Reference")
                            uri = getattr(web, "uri", "")
                            if uri and {"title": title, "url": uri} not in sources:
                                sources.append({"title": title, "url": uri})

                # Formulate next step query based on findings
                if step < depth and res.text:
                    refine_prompt = (
                        f"Based on the research findings so far: '{res.text[:800]}'\n"
                        "What is the most important follow-up question or sub-topic to research next to get a deeper understanding? "
                        "Return ONLY the search query text."
                    )
                    next_query_res = client.models.generate_content(
                        model=self.model,
                        contents=refine_prompt,
                    )
                    current_query = (next_query_res.text or "").strip().strip("\"'")
                    if not current_query:
                        current_query = topic

            if not sources:
                raise RuntimeError("research returned no verifiable grounding sources")

            # Final synthesis step
            logger.info("Synthesizing final research report...")
            synthesis_prompt = (
                f"Synthesize the following research findings into a comprehensive, structured Markdown report about '{topic}'. "
                "Ground claims only in the provided findings and source URLs; omit unsupported claims.\n\n"
                + "\n\n".join(f"--- Round findings: ---\n{f}" for f in findings)
                + "\n\nSources:\n"
                + "\n".join(src["url"] for src in sources)
            )

            final_res = client.models.generate_content(
                model=self.model,
                contents=synthesis_prompt,
            )

            if not final_res.text or not final_res.text.strip():
                raise RuntimeError("research synthesis returned no content")
            report_content = final_res.text

            # Append bibliography sources
            if sources:
                report_content += "\n\n## References & Sources\n\n"
                for idx, src in enumerate(sources, 1):
                    report_content += f"{idx}. [{src['title']}]({src['url']})\n"

            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(report_content, encoding="utf-8")
            logger.info(f"Saved research report to: {out_path}")
            return out_path

        except Exception as exc:
            logger.warning("Research failed: %s", type(exc).__name__)
            raise RuntimeError("research failed; no new report was saved") from exc
